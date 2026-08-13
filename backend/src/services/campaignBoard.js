const db = require('../config/db');
const { getProposalsV3, getProposals } = require('./externalApi');
const { getSellerIdsPorFranquia, getRoboSellerIds } = require('./franquiaSellers');
const { buildExcluder, carregarExclusoes } = require('./rankingFilters');

/**
 * Cálculo do placar de campanha (giro/escada).
 *
 * Vive aqui, e não na rota, porque tem dois consumidores: o endpoint ao vivo e o
 * congelador que grava `campaign_results` na virada do dia. Se divergirem, o
 * número congelado deixa de ser o mesmo que o telão mostrou.
 */

// Frescor das propostas. O dia corrente mantém o TTL curto — quem está vendendo
// precisa ver a própria venda entrar. Dia encerrado não recebe venda nova.
const TTL_DIA_VIVO = 60_000;
const TTL_DIA_ENCERRADO = 10 * 60_000;

/** Data de hoje no fuso de São Paulo (en-CA formata como YYYY-MM-DD). */
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function pgDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Escada de prêmios cumulativa.
 *
 * Conferido contra o documento da Missão Resgate:
 *   20 vendas → R$ 110   ·   25 vendas → R$ 160   ·   9 vendas → falta 1 para a próxima faixa
 */
function ladderFor(count, ladder = [], step = null, spinEvery = null) {
  const tiers = [...(ladder || [])].sort((a, b) => a.at - b.at);
  let prize = 0;

  for (const t of tiers) {
    if (count >= t.at) prize += Number(t.prize) || 0;
  }

  const lastTierAt = tiers.length ? tiers[tiers.length - 1].at : 0;

  // Faixas repetidas depois da última ("a cada +5 vendas, +R$20")
  if (step?.every > 0 && count > lastTierAt) {
    const extra = Math.floor((count - lastTierAt) / step.every);
    prize += extra * (Number(step.prize) || 0);
  }

  let nextAt = null;
  let nextPrize = null;
  const upcoming = tiers.find(t => t.at > count);
  if (upcoming) {
    nextAt = upcoming.at;
    nextPrize = Number(upcoming.prize) || 0;
  } else if (step?.every > 0) {
    const stepsDone = Math.floor((count - lastTierAt) / step.every);
    nextAt = lastTierAt + (stepsDone + 1) * step.every;
    nextPrize = Number(step.prize) || 0;
  }

  return {
    prize_value: prize,
    spins: spinEvery > 0 ? Math.floor(count / spinEvery) : 0,
    next_at: nextAt,
    next_prize: nextPrize,
    missing: nextAt === null ? null : nextAt - count,
  };
}

/** Dia que o placar da campanha representa. */
function diaDoPlacar(campaign, dateQuery) {
  return dateQuery || pgDateStr(campaign.start_date) || todayBR();
}

let _avisouLegado = false;

/**
 * Propostas pagas no dia, pela v3 quando há token e pela API antiga quando não há.
 *
 * A v3 (`developers.newcorban.com.br`) exige `NEWCORBAN_PROPOSALS_TOKEN`, emitido
 * no painel. Sem ele o placar morria inteiro — e as credenciais da API antiga
 * (`NEWCORBAN_API_USERNAME`/`PASSWORD`), que o app já usa para outras coisas,
 * bastam para o mesmo dado. As duas devolvem o mesmo formato: `convertV3Proposal`
 * foi escrita para imitar o da antiga.
 *
 * Diferenças que o fallback precisa cobrir:
 *  - a v3 filtra `stage=['paid']`; a antiga não tem esse filtro, então cancelada
 *    com data de pagamento é descartada aqui;
 *  - a antiga só enxerga ~30 dias para trás e fixa `produto: ['7','13']`, então
 *    campanha antiga ou de outro produto volta vazia. O `paid_today === 0` do
 *    congelador já barra gravar isso como resultado.
 */
async function buscarPropostasPagas(day, ttlMs) {
  if (process.env.NEWCORBAN_PROPOSALS_TOKEN) {
    return { proposals: await getProposalsV3(day, day, [], 'payment', ['paid'], ttlMs), fonte: 'v3' };
  }

  if (!_avisouLegado) {
    console.warn(
      '[Placar] NEWCORBAN_PROPOSALS_TOKEN ausente — usando a API antiga de propostas. ' +
      'Ela só cobre ~30 dias e os produtos 7/13; configure o token para o comportamento pleno.'
    );
    _avisouLegado = true;
  }

  const raw = await getProposals(day, day, [], 'pagamento');
  const proposals = {};
  for (const [id, p] of Object.entries(raw || {})) {
    if (p?.api?.status_api === 'CANCELADA' || p?.datas?.cancelado) continue;
    proposals[id] = p;
  }
  return { proposals, fonte: 'legado' };
}

/**
 * Monta o placar do dia a partir da NewCorban. Lança se as propostas ou o
 * cadastro de consultores não puderem ser lidos — quem chama decide se mostra
 * "indisponível" ou se adia o congelamento.
 */
async function montarPlacar(campaign, day) {
  const products = new Set((campaign.product_ids || []).map(String));
  const ttlPropostas = day < todayBR() ? TTL_DIA_ENCERRADO : TTL_DIA_VIVO;

  // Franquias participantes (ex: ['matriz']). NULL = empresa inteira.
  const franquiaIds = campaign.franquia_ids || [];

  // Propostas e cadastro de consultores são independentes — em série somavam
  // duas idas à NewCorban no caminho frio.
  const [propostasRes, sellersRes, robosRes, excRes] = await Promise.allSettled([
    // Pagas no dia; o filtro de cadastro no mesmo dia vem logo abaixo.
    buscarPropostasPagas(day, ttlPropostas),
    // Propaga o erro de propósito: se o cadastro de consultores não puder ser
    // lido, o placar mostra "indisponível" em vez de uma lista errada na TV.
    getSellerIdsPorFranquia(franquiaIds),
    // Robôs pela flag do cadastro, não por padrão de nome: "NOVA IA" é conta de
    // robô e não casa com API%/BOT%/ROBO%. Se o cadastro não puder ser lido,
    // cai de volta nos padrões em vez de deixar o placar vazio.
    getRoboSellerIds(),
    carregarExclusoes(),
  ]);

  // Rejeição relançada na mesma ordem em que era aguardada, para o erro que
  // chega ao 502 continuar sendo o mesmo de antes.
  for (const r of [propostasRes, sellersRes, robosRes, excRes]) {
    if (r.status === 'rejected') throw r.reason;
  }

  const { proposals, fonte } = propostasRes.value;
  const sellersDaFranquia = sellersRes.value;
  const robos = robosRes.value;
  const isExcluded = buildExcluder(excRes.value);

  const byVendor = new Map();
  let excludedContracts = 0;   // contas não-humanas
  let otherDayContracts = 0;   // pagos hoje, mas digitados em outro dia
  let otherProductContracts = 0;
  let otherFranquiaContracts = 0;
  let paidTotal = 0;

  for (const p of Object.values(proposals)) {
    const paid = p.datas?.pagamento ? String(p.datas.pagamento).slice(0, 10) : null;
    if (paid !== day) continue;
    paidTotal++;

    if (products.size && !products.has(String(p.proposta?.produto_id))) { otherProductContracts++; continue; }

    // "Digitado e pago no mesmo dia" — comparação por contrato, não por agregado
    if (campaign.require_same_day) {
      const created = p.datas?.cadastro ? String(p.datas.cadastro).slice(0, 10) : null;
      if (created !== day) { otherDayContracts++; continue; }
    }

    const vid = String(p.vendedor_id || '');
    if (!vid) continue;

    // Só as franquias da campanha. Lista branca pelo cadastro, não pelo nome:
    // quem não está no cadastro do NewCorban também não entra.
    if (sellersDaFranquia && !sellersDaFranquia.has(vid)) { otherFranquiaContracts++; continue; }

    const vname = p.vendedor_nome || '';
    if (robos?.has(vid) || isExcluded(vid, vname)) { excludedContracts++; continue; }

    if (!byVendor.has(vid)) {
      byVendor.set(vid, { vendor_id: vid, vendor_name: vname, team: p.equipe_nome || '', contracts: 0, total_value: 0 });
    }
    const agg = byVendor.get(vid);
    agg.contracts += 1;
    agg.total_value += parseFloat(p.proposta?.valor_referencia || 0) || 0;
    if (!agg.vendor_name && vname) agg.vendor_name = vname;
  }

  // Nome do vendedor pela base local quando a API não trouxe
  const missingNames = [...byVendor.values()].filter(v => !v.vendor_name).map(v => v.vendor_id);
  if (missingNames.length) {
    const { rows: users } = await db.query(
      `SELECT corban_id, COALESCE(display_name, corban_name, username) AS nome
       FROM users WHERE corban_id = ANY($1)`,
      [missingNames]
    );
    const nameById = new Map(users.map(u => [String(u.corban_id), u.nome]));
    for (const v of byVendor.values()) {
      if (!v.vendor_name) v.vendor_name = nameById.get(v.vendor_id) || `Consultor ${v.vendor_id}`;
    }
  }

  const board = [...byVendor.values()]
    .sort((a, b) => b.contracts - a.contracts || b.total_value - a.total_value)
    .map((v, i) => ({
      position: i + 1,
      ...v,
      ...ladderFor(v.contracts, campaign.ladder, campaign.ladder_step, campaign.spin_every),
    }));

  return {
    board,
    totals: {
      contracts: board.reduce((s, v) => s + v.contracts, 0),
      value: board.reduce((s, v) => s + v.total_value, 0),
      participants: board.length,
    },
    // Diagnóstico: distingue "ninguém vendeu" de "o filtro está apertado demais".
    // No dia da campanha isso é o que evita horas de dúvida sobre o placar.
    diagnostics: {
      paid_today: paidTotal,
      excluded_non_human: excludedContracts,
      other_product: otherProductContracts,
      paid_but_registered_another_day: otherDayContracts,
      other_franquia: otherFranquiaContracts,
      franquia_ids: franquiaIds.length ? franquiaIds : null,
      franquia_sellers: sellersDaFranquia ? sellersDaFranquia.size : null,
      // De onde vieram as propostas — sem isto, um placar servido pela API antiga
      // (janela de 30 dias, produtos 7/13) é indistinguível de um servido pela v3.
      source: fonte,
    },
  };
}

module.exports = {
  montarPlacar,
  ladderFor,
  buildExcluder,
  todayBR,
  pgDateStr,
  diaDoPlacar,
  TTL_DIA_VIVO,
  TTL_DIA_ENCERRADO,
};
