const db = require('../config/db');

async function getManagedGroupIds(userId) {
  const { rows } = await db.query(
    'SELECT group_id FROM admin_team_scopes WHERE user_id = $1',
    [userId]
  );
  return rows.map(r => r.group_id);
}

async function setManagedGroups(userId, groupIds) {
  await db.query('DELETE FROM admin_team_scopes WHERE user_id = $1', [userId]);
  const ids = [...new Set((groupIds || []).map(id => parseInt(id, 10)).filter(Boolean))];
  for (const gid of ids) {
    await db.query(
      'INSERT INTO admin_team_scopes (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, gid]
    );
  }
  return ids;
}

module.exports = { getManagedGroupIds, setManagedGroups };
