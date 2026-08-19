const db = require('../config/db');
const { montarPlacar, todayBR, pgDateStr, diaDoPlacar } = require('./campaignBoard');
const { buildExcluder, carregarExclusoes } = require('./rankingFilters');
const { invalidateResponseCache } = require('../middleware/responseCache');

/**
 * Congelamento do placar na virada do dia.
 *
 * Decisão do cliente (ago/2026): congela **uma vez**, logo que o dia da campanha
 * termina, e não muda mais. Pagamento confirmado pelo banco depois da meia-noite
 * não entra — se precisar corrigir, o admin recongela pelo painel.
 *
 * Congelar é o que torna o telão de campanha encerrada instantâneo: o endpoint
 * passa a ler `campaign_results` em vez de reconstruir da NewCorban para sempre.
 */

/** Campanhas cujo dia já acabou e que ainda não têm resultado gravado. */
async function pendentes() {
  const { rows } = await db.query(`
    SELECT c.* FROM campaigns c
    WHERE c.legacy_kind IS NULL
      AND c.end_date IS NOT NULL
      AND c.end_date < $1::date
      AND NOT EXISTS (SELECT 1 FROM campaign_results r WHERE r.campaign_id = c.id)
    ORDER BY c.end_date
  `, [todayBR()]);
  return rows;
}

/**
 * Grava o placar de uma campanha e a marca como encerrada.
 *
 * `force` refaz o snapshot de uma campanha já congelada (botão do painel).
 * Sem `force`, quem já tem resultado é ignorado — congelar é operação única.
 */
async function congelarCampanha(campaign, { force = false } = {}) {
  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM campaign_results WHERE campaign_id = $1`,
    [campaign.id]
  );
  if (n > 0 && !force) return { status: 'ja_congelada', campaign_id: campaign.id };

  const day = diaDoPlacar(campaign, null);
  const { board, totals, diagnostics } = await montarPlacar(campaign, day);

  // Placar vazio COM a API respondendo é resultado legítimo; placar vazio porque
  // a API não devolveu nenhum pago no dia inteiro da empresa é quase sempre
  // leitura ruim, e congelar isso grava zero para sempre. Adia e tenta de novo.
  if (diagnostics.paid_today === 0 && !force) {
    return { status: 'adiado', campaign_id: campaign.id, motivo: 'nenhum contrato pago no dia — leitura suspeita' };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM campaign_results WHERE campaign_id = $1`, [campaign.id]);

    for (const v of board) {
      // next_at/next_prize/missing vêm prontos de `montarPlacar` (via `ladderFor`)
      // — gravados aqui para o snapshot não depender mais da escada AO VIVO da
      // campanha na hora de exibir. Ver a migration para o motivo.
      await client.query(
        `INSERT INTO campaign_results
           (campaign_id, position, vendor_id, vendor_name, team, contracts, total_value,
            prize_value, spins, next_at, next_prize, missing)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [campaign.id, v.position, v.vendor_id, v.vendor_name, v.team || null,
         v.contracts, v.total_value, v.prize_value, v.spins,
         v.next_at ?? null, v.next_prize ?? null, v.missing ?? null]
      );
    }

    // `frozen_date` grava o mesmo `day` usado para montar o placar — é o
    // discriminador que diz "este snapshot já traz next_at/next_prize/missing
    // travados" (ver migration). Sem ele, `lerCongelado` não teria como saber
    // se uma linha antiga simplesmente tem os três campos vazios por acaso
    // (vendedor que já bateu o último degrau) ou por ainda não ter sido
    // recongelada desde que passaram a ser gravados.
    await client.query(
      `UPDATE campaigns
          SET status = 'closed', frozen_diagnostics = $1::jsonb, frozen_date = $2, updated_at = NOW()
        WHERE id = $3`,
      [JSON.stringify(diagnostics), day, campaign.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // O placar ao vivo pode estar cacheado por até 10 min — sem isso o telão
  // continuaria servindo a versão pré-congelamento.
  invalidateResponseCache([`/api/campaigns/${campaign.id}/board`]);

  console.log(
    `[Congelamento] "${campaign.name}" (${day}): ${board.length} participante(s), ` +
    `${totals.contracts} contrato(s)${force ? ' — recongelada' : ''}`
  );
  return { status: force ? 'recongelada' : 'congelada', campaign_id: campaign.id, date: day, board, totals, diagnostics };
}

/**
 * Marca a campanha como encerrada porque a data dela passou.
 *
 * Separado do congelamento de propósito: "a campanha acabou" é fato do
 * calendário e não pode depender de a NewCorban responder. Antes, uma API fora
 * do ar deixava a campanha `active` para sempre — aparecendo em "Concluídas" na
 * tela, que classifica por data, e como ativa no banco.
 */
async function marcarConcluida(campaign) {
  if (campaign.status === 'closed') return false;

  const { rowCount } = await db.query(
    `UPDATE campaigns SET status = 'closed', updated_at = NOW()
      WHERE id = $1 AND status <> 'closed'`,
    [campaign.id]
  );
  if (rowCount) {
    campaign.status = 'closed';
    invalidateResponseCache([`/api/campaigns/${campaign.id}/board`]);
    console.log(`[Congelamento] "${campaign.name}" marcada como concluída (data encerrada)`);
  }
  return rowCount > 0;
}

/**
 * Fecha e congela tudo que já venceu. Roda no cron das 00:05 e também na subida
 * do app, para cobrir o caso de o servidor estar fora do ar na virada.
 *
 * O encerramento acontece sempre; o congelamento só quando a leitura é confiável.
 * Falha de uma campanha não impede as outras, e nada é gravado a partir de
 * leitura que deu erro — como `pendentes()` filtra por ausência de resultado (e
 * não por status), a campanha continua na fila e tenta de novo na próxima passada.
 */
async function congelarPendentes() {
  let campanhas;
  try {
    campanhas = await pendentes();
  } catch (err) {
    console.error('[Congelamento] não foi possível listar pendentes:', err.message);
    return [];
  }
  if (!campanhas.length) return [];

  const resultados = [];
  for (const c of campanhas) {
    // Primeiro o que é certo: a data acabou. Só depois o que depende da API.
    try {
      await marcarConcluida(c);
    } catch (err) {
      console.error(`[Congelamento] não foi possível encerrar "${c.name}": ${err.message}`);
    }

    try {
      const r = await congelarCampanha(c);
      if (r.status === 'adiado') {
        console.warn(`[Congelamento] "${c.name}" adiada: ${r.motivo}`);
      }
      resultados.push(r);
    } catch (err) {
      console.error(`[Congelamento] "${c.name}" falhou: ${err.message}`);
      resultados.push({ status: 'erro', campaign_id: c.id, erro: err.message });
    }
  }
  return resultados;
}

/** Lê o placar congelado. Devolve null quando a campanha ainda não tem snapshot. */
async function lerCongelado(campaign) {
  const { rows } = await db.query(
    `SELECT position, vendor_id, vendor_name, team, contracts, total_value, prize_value, spins,
            next_at, next_prize, missing
     FROM campaign_results WHERE campaign_id = $1 ORDER BY position`,
    [campaign.id]
  );
  if (!rows.length) return null;

  // Snapshots antigos também obedecem à barreira atual de contas não-humanas.
  // Não exige recongelar nem altera o histórico bruto; apenas impede que uma IA
  // continue visível porque foi gravada antes de o filtro conhecê-la.
  const exclusoes = await carregarExclusoes().catch(() => []);
  const isExcluded = buildExcluder(exclusoes);
  const humanos = rows.filter(r => !isExcluded(r.vendor_id, r.vendor_name));
  const removidos = rows.length - humanos.length;

  // `frozen_date` é o discriminador: só existe a partir de quando o congelamento
  // passou a gravar next_at/next_prize/missing junto com o resto (ver migration).
  // Sem ele, um snapshot anterior a essa mudança tem os três campos NULL — e não
  // dá para distinguir "vendedor que já bateu o último degrau" (também NULL,
  // legitimamente) de "esta linha nunca gravou o valor". `frozen_date` resolve
  // essa ambiguidade: presente = confia no que foi gravado; ausente = recalcula
  // ao vivo, exatamente como sempre funcionou para esse snapshot mais antigo.
  const travado = Boolean(campaign.frozen_date);

  const board = humanos.map((r, index) => ({
    position: index + 1,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    team: r.team || '',
    contracts: Number(r.contracts),
    total_value: Number(r.total_value),
    prize_value: Number(r.prize_value),
    spins: Number(r.spins),
    ...(travado
      ? { next_at: r.next_at, next_prize: r.next_prize === null ? null : Number(r.next_prize), missing: r.missing }
      // next_at/next_prize/missing derivam de contracts + config da campanha. Sem
      // recalcular, o telão renderiza "faltam undefined para o próximo giro".
      : derivarProximoDegrau(r, campaign)),
  }));

  return {
    date: travado ? pgDateStr(campaign.frozen_date) : (pgDateStr(campaign.end_date) || pgDateStr(campaign.start_date)),
    board,
    totals: {
      contracts: board.reduce((s, v) => s + v.contracts, 0),
      value: board.reduce((s, v) => s + v.total_value, 0),
      participants: board.length,
    },
    diagnostics: {
      ...(campaign.frozen_diagnostics || {}),
      excluded_frozen_non_human: removidos,
    },
  };
}

/** Compatibilidade: snapshot congelado antes de next_at/next_prize/missing existirem. */
function derivarProximoDegrau(row, campaign) {
  const { ladderFor } = require('./campaignBoard');
  const { next_at, next_prize, missing } = ladderFor(
    Number(row.contracts), campaign.ladder, campaign.ladder_step, campaign.spin_every
  );
  return { next_at, next_prize, missing };
}

module.exports = { congelarPendentes, congelarCampanha, marcarConcluida, lerCongelado, pendentes };
