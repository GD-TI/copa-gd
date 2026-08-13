const db = require('../config/db');
const { getInfoVendedores } = require('./franquiaSellers');

/**
 * Vínculo dono ↔ franquia (`admin_franquia_scopes`).
 *
 * Espelha `adminScopes.js`, que faz o mesmo para sub-admin ↔ equipe. A diferença
 * é o tipo do identificador: franquia é VARCHAR e vem do NewCorban (inclui o
 * token `'matriz'`), então nada de `parseInt` — `'matriz'` viraria NaN e o dono
 * ficaria sem escopo, que é justamente o estado perigoso (ver campaignAccess.js).
 */

/** Normaliza uma lista de franquias: texto aparado, sem vazios nem repetidos. */
function normalizarFranquiaIds(ids) {
  return [...new Set(
    (ids || []).map(id => String(id ?? '').trim()).filter(Boolean)
  )];
}

async function getManagedFranquiaIds(userId) {
  const { rows } = await db.query(
    'SELECT franquia_id FROM admin_franquia_scopes WHERE user_id = $1 ORDER BY franquia_id',
    [userId]
  );
  return rows.map(r => r.franquia_id);
}

async function setManagedFranquias(userId, franquiaIds) {
  const ids = normalizarFranquiaIds(franquiaIds);
  await db.query('DELETE FROM admin_franquia_scopes WHERE user_id = $1', [userId]);
  for (const fid of ids) {
    await db.query(
      'INSERT INTO admin_franquia_scopes (user_id, franquia_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, fid]
    );
  }
  return ids;
}

/**
 * Franquia de um consultor, pelo cadastro do NewCorban.
 *
 * Não há vínculo local: a franquia do consultor mora na NewCorban (cacheada 15
 * min junto com o mapa que o placar usa). Se o cadastro não puder ser lido,
 * devolve lista vazia — e o efeito, lá na visibilidade, é ele enxergar apenas
 * campanhas da empresa inteira. Preferimos esconder demais a vazar campanha de
 * outra franquia por causa de uma falha de API.
 */
async function getFranquiasDoConsultor(userId) {
  const { rows } = await db.query('SELECT corban_id FROM users WHERE id = $1', [userId]);
  const corbanId = rows[0]?.corban_id;
  if (!corbanId) return [];

  const info = await getInfoVendedores();
  if (!info) return [];

  const franquia = info.get(String(corbanId))?.franquia;
  return franquia ? [franquia] : [];
}

/**
 * Escopo de franquia do usuário logado.
 *   admin      → null (todas)
 *   franqueado → as que a matriz vinculou
 *   demais     → a própria, pelo cadastro do NewCorban
 */
async function resolverEscopoDeFranquia(user) {
  if (!user) return [];
  if (user.role === 'admin') return null;
  if (user.role === 'franqueado') return getManagedFranquiaIds(user.id);
  return getFranquiasDoConsultor(user.id);
}

module.exports = {
  getManagedFranquiaIds,
  setManagedFranquias,
  normalizarFranquiaIds,
  getFranquiasDoConsultor,
  resolverEscopoDeFranquia,
};
