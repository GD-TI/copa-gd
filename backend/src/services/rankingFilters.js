const db = require('../config/db');

/**
 * Quem não disputa ranking: robôs, integrações e contas de estrutura.
 *
 * Vive aqui, e não no `campaignBoard`, porque tem dois consumidores — o placar
 * de campanha e o ranking individual. Sem este filtro o pódio de qualquer um
 * dos dois é ocupado pela IA: em 11/08/2026 a NOVA IA digitou 270 contratos no
 * dia e o Jarvis 268, contra 36 do primeiro consultor humano.
 */

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
    if (ids.has(String(vendorId))) return true;
    const name = String(vendorName || '').trim();
    return name !== '' && patterns.some(rx => rx.test(name));
  };
}

async function carregarExclusoes() {
  const { rows } = await db.query(
    `SELECT corban_id, name_pattern FROM ranking_exclusions WHERE active = true`
  );
  return rows;
}

module.exports = { buildExcluder, carregarExclusoes };
