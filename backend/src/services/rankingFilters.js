const db = require('../config/db');

/**
 * Quem não disputa ranking: robôs, integrações e contas de estrutura.
 *
 * Vive aqui, e não no `campaignBoard`, porque tem dois consumidores — o placar
 * de campanha e o ranking individual. Sem este filtro o pódio de qualquer um
 * dos dois é ocupado pela IA: em 11/08/2026 a NOVA IA digitou 270 contratos no
 * dia e o Jarvis 268, contra 36 do primeiro consultor humano.
 */

// Barreira estrutural, independente do cadastro e do banco. Algumas contas de
// IA chegam sem `robo=true` e bancos antigos não recebem novos padrões só por já
// terem linhas em ranking_exclusions. Estes IDs são conhecidos no NewCorban; os
// padrões cobrem novas contas nomeadas como IA, API, bot, Jarvis ou Maia.
const IDS_NAO_HUMANOS = new Set(['1013', '24693']);
const NOMES_NAO_HUMANOS = [
  /\bjarvis\b/i,
  /\bmaia\b/i,
  /\b(?:nova\s+)?ia\b/i,
  /\bapi\b/i,
  /\bbot\b/i,
  /(?:^|\W)rob[oô](?:\W|$)/i,
];

/** Contas não-humanas: a IA é a linha de base da campanha, não concorrente. */
function buildExcluder(rows) {
  const ids = new Set(rows.filter(r => r.corban_id).map(r => String(r.corban_id)));
  const patterns = rows
    .filter(r => r.name_pattern)
    .map(r => {
      const rx = String(r.name_pattern)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*');
      return new RegExp(`^${rx}$`, 'i');
    });

  return (vendorId, vendorName) => {
    if (IDS_NAO_HUMANOS.has(String(vendorId)) || ids.has(String(vendorId))) return true;
    const name = String(vendorName || '').trim();
    return name !== '' && (
      NOMES_NAO_HUMANOS.some(rx => rx.test(name)) ||
      patterns.some(rx => rx.test(name))
    );
  };
}

async function carregarExclusoes() {
  const { rows } = await db.query(
    `SELECT corban_id, name_pattern FROM ranking_exclusions WHERE active = true`
  );
  return rows;
}

module.exports = {
  buildExcluder,
  carregarExclusoes,
  IDS_NAO_HUMANOS,
  NOMES_NAO_HUMANOS,
};
