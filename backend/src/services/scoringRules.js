const db = require('../config/db');

const FALLBACK = {
  META_DIA: 5, META_SEMANA: 10, CONVERSAO: 5, INDICACAO: 10,
  CONTRATO_10K: 5, GOL_DE_PLACA: 15, TORCIDA_ORGANIZADA: 20, ARTILHEIRO: 15,
};

let cache = null;
let cacheAt = 0;
const TTL = 60_000;

async function getRulePointsMap() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const { rows } = await db.query('SELECT rule_name, base_points FROM scoring_rules');
  const map = { ...FALLBACK };
  rows.forEach(r => {
    const pts = parseFloat(r.base_points);
    map[r.rule_name] = isNaN(pts) ? (FALLBACK[r.rule_name] || 0) : pts;
  });
  cache = map;
  cacheAt = Date.now();
  return map;
}

function invalidateRuleCache() {
  cache = null;
  cacheAt = 0;
}

async function getRulesList() {
  const { rows } = await db.query(
    'SELECT rule_name, label, description, icon, base_points FROM scoring_rules ORDER BY rule_name'
  );
  return rows.map(r => ({
    name: r.rule_name,
    label: r.label,
    description: r.description,
    icon: r.icon,
    points: parseFloat(r.base_points),
  }));
}

module.exports = { getRulePointsMap, getRulesList, invalidateRuleCache, FALLBACK };
