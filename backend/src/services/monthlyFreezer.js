const db = require('../config/db');
const { rankingMensal, limitesDoMes, mesAtual } = require('./rankingIndividual');
const { invalidateResponseCache } = require('../middleware/responseCache');

/**
 * Congelamento do ranking individual mensal.
 *
 * O ranking **ao vivo** não precisa disto: a janela é o mês, e a virada
 * acontece sozinha. Isto existe só pelo histórico — decisão do cliente
 * (12/08/2026): o mês encerrado vira foto imutável, "sem ficar alterando".
 * Sem a foto, um estorno lançado em setembro mudaria o resultado de agosto
 * retroativamente, e o mês passado seria reconstruído da NewCorban para sempre.
 *
 * Diferença deliberada em relação ao `campaignFreezer`: **não há recongelar**.
 * Lá existe botão porque um pagamento pode ser confirmado depois da meia-noite
 * do único dia da campanha. Aqui o pedido foi explícito — o mês fechado não se
 * mexe mais.
 */

/** Quantos meses para trás procurar mês não congelado na repescagem. */
const MESES_DE_REPESCAGEM = 6;

/** O driver `pg` devolve DATE como objeto Date; cortar a string crua daria outro dia. */
function pgDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

/** Mês anterior a `mes` (YYYY-MM), sem passar por `new Date(string)`. */
function mesAnterior(mes) {
  const [ano, m] = mes.split('-').map(Number);
  return m === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(m - 1).padStart(2, '0')}`;
}

/** Meses já encerrados que ainda não têm foto, do mais antigo ao mais recente. */
async function pendentes(quantos = MESES_DE_REPESCAGEM) {
  const candidatos = [];
  let mes = mesAnterior(mesAtual());          // o mês corrente nunca é candidato
  for (let i = 0; i < quantos; i++) {
    candidatos.push(mes);
    mes = mesAnterior(mes);
  }

  const { rows } = await db.query(
    `SELECT month_ref FROM monthly_ranking_meta WHERE month_ref = ANY($1)`,
    [candidatos]
  );
  const congelados = new Set(rows.map(r => String(r.month_ref).trim()));

  return candidatos.filter(m => !congelados.has(m)).reverse();
}

/**
 * Grava a foto de um mês. Operação única: mês já congelado é ignorado.
 *
 * A guarda contra leitura ruim é a mesma ideia do placar de campanha — um mês
 * com zero participante na empresa inteira é quase certamente API fora do ar, e
 * gravar isso deixa o histórico zerado para sempre. Adia, e a próxima passada
 * tenta de novo, porque `pendentes()` filtra por ausência de foto.
 */
async function congelarMes(mes) {
  const { rows: [ja] } = await db.query(
    `SELECT month_ref FROM monthly_ranking_meta WHERE month_ref = $1`, [mes]
  );
  if (ja) return { status: 'ja_congelado', mes };

  const janela = limitesDoMes(mes);
  if (janela.ao_vivo || janela.futuro) {
    return { status: 'recusado', mes, motivo: 'o mês ainda não terminou' };
  }

  const { board, totals, diagnostics } = await rankingMensal(mes);

  if (board.length === 0) {
    return { status: 'adiado', mes, motivo: 'nenhum participante no mês inteiro — leitura suspeita' };
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM monthly_rankings WHERE month_ref = $1`, [mes]);

    for (const v of board) {
      await client.query(
        `INSERT INTO monthly_rankings
           (month_ref, position, vendedor_id, nome, foto, equipe, franquia_nome, contratos, valor, valor_meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [mes, v.position, v.vendedor_id, v.nome, v.foto, v.equipe, v.franquia_nome,
         v.contratos, v.valor, v.valor_meta]
      );
    }

    await client.query(
      `INSERT INTO monthly_ranking_meta
         (month_ref, inicio, fim, participantes, contratos, valor, diagnostics)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [mes, janela.inicio, janela.fim, board.length, totals.contratos, totals.valor,
       JSON.stringify(diagnostics)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // O mês recém-encerrado pode estar cacheado por até 10 min como resposta ao
  // vivo — sem isto a tela continuaria servindo a versão pré-congelamento.
  invalidateResponseCache(['/api/rankings']);

  console.log(
    `[Ranking mensal] ${mes} congelado: ${board.length} participante(s), ` +
    `${totals.contratos} contrato(s), R$ ${totals.valor.toLocaleString('pt-BR')}`
  );
  return { status: 'congelado', mes, participantes: board.length, totals };
}

/**
 * Congela tudo que já venceu e ainda não tem foto.
 *
 * Roda no cron do dia 1º e também na subida do app — se o servidor estiver fora
 * do ar na virada do mês, a repescagem pega. Falha de um mês não impede os
 * outros, e nada é gravado a partir de leitura que deu erro.
 */
async function congelarMesesPendentes() {
  let meses;
  try {
    meses = await pendentes();
  } catch (err) {
    console.error('[Ranking mensal] não foi possível listar meses pendentes:', err.message);
    return [];
  }
  if (!meses.length) return [];

  const resultados = [];
  for (const mes of meses) {
    try {
      const r = await congelarMes(mes);
      if (r.status === 'adiado') console.warn(`[Ranking mensal] ${mes} adiado: ${r.motivo}`);
      resultados.push(r);
    } catch (err) {
      console.error(`[Ranking mensal] ${mes} falhou: ${err.message}`);
      resultados.push({ status: 'erro', mes, erro: err.message });
    }
  }
  return resultados;
}

/** Lê a foto de um mês. Devolve null quando o mês ainda não foi congelado. */
async function lerCongelado(mes) {
  const { rows: [meta] } = await db.query(
    `SELECT month_ref, inicio, fim, participantes, contratos, valor, diagnostics, frozen_at
       FROM monthly_ranking_meta WHERE month_ref = $1`,
    [mes]
  );
  if (!meta) return null;

  const { rows } = await db.query(
    `SELECT position, vendedor_id, nome, foto, equipe, franquia_nome, contratos, valor, valor_meta
       FROM monthly_rankings WHERE month_ref = $1 ORDER BY position`,
    [mes]
  );

  const board = rows.map(r => {
    const valor = Number(r.valor);
    const meta_v = Number(r.valor_meta);
    return {
      position: Number(r.position),
      vendedor_id: r.vendedor_id,
      nome: r.nome,
      foto: r.foto || null,
      equipe: r.equipe || null,
      franquia_nome: r.franquia_nome || null,
      contratos: Number(r.contratos),
      valor,
      valor_meta: meta_v,
      // Derivado, nunca gravado: se ficasse na tabela, um arredondamento
      // diferente aqui e ali faria o congelado divergir do ao vivo.
      atingimento: meta_v > 0 ? Math.round((valor / meta_v) * 10000) / 100 : null,
    };
  });

  const janela = limitesDoMes(mes);
  return {
    mes,
    inicio: pgDateStr(meta.inicio) || janela.inicio,
    fim: pgDateStr(meta.fim) || janela.fim_do_mes,
    fim_do_mes: janela.fim_do_mes,
    ao_vivo: false,
    futuro: false,
    congelado: true,
    frozen_at: meta.frozen_at,
    board,
    totals: {
      contratos: Number(meta.contratos),
      valor: Number(meta.valor),
      participantes: Number(meta.participantes),
    },
    diagnostics: meta.diagnostics || null,
  };
}

/** Meses com foto, do mais recente para o mais antigo. */
async function mesesCongelados() {
  const { rows } = await db.query(
    `SELECT month_ref, participantes, contratos, valor, frozen_at
       FROM monthly_ranking_meta ORDER BY month_ref DESC`
  );
  return rows.map(r => ({
    mes: String(r.month_ref).trim(),
    participantes: Number(r.participantes),
    contratos: Number(r.contratos),
    valor: Number(r.valor),
    frozen_at: r.frozen_at,
  }));
}

module.exports = {
  congelarMesesPendentes,
  congelarMes,
  lerCongelado,
  mesesCongelados,
  pendentes,
  mesAnterior,
};
