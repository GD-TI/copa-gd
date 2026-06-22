const db = require('../config/db');

/** Permite role team_admin + tabela admin_team_scopes (idempotente). */
async function migrateTeamAdminSupport() {
  const { rows: roleChecks } = await db.query(`
    SELECT c.conname,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.users'::regclass
      AND c.contype = 'c'
      AND a.attname = 'role'
  `);

  const hasTeamAdmin = roleChecks.some(r =>
    String(r.def).includes('team_admin')
  );

  if (!hasTeamAdmin) {
    for (const { conname } of roleChecks) {
      await db.query(`ALTER TABLE users DROP CONSTRAINT "${conname}"`);
    }
    try {
      await db.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('player', 'admin', 'team_admin'))
      `);
    } catch (err) {
      if (err.code !== '42710') throw err;
    }
    console.log('[Migration] users.role: team_admin habilitado');
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_team_scopes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, group_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_team_scopes_user ON admin_team_scopes(user_id)
  `);
}

module.exports = { migrateTeamAdminSupport };
