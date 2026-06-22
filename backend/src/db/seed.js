const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function seed() {
  try {
    // Admin padrão
    const hash = await bcrypt.hash('admin2026', 10);
    await db.query(
      `INSERT INTO users (username, password_hash, role, display_name)
       VALUES ('admin', $1, 'admin', 'Administrador')
       ON CONFLICT (username) DO NOTHING`,
      [hash]
    );
    console.log('[Seed] Admin padrão criado (usuário: admin, senha: admin2026)');

    // Colunas de meta em R$ por grupo (migration idempotente)
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS daily_goal_value  NUMERIC DEFAULT 0`);
    await db.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS weekly_goal_value NUMERIC DEFAULT 0`);

    // Tabela de configurações da campanha (migration idempotente)
    await db.query(`
      CREATE TABLE IF NOT EXISTS campaign_settings (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL DEFAULT 'Copa GD 2026',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Campanha padrão (apenas se não existir nenhuma)
    const { rows: existing } = await db.query('SELECT id FROM campaign_settings LIMIT 1');
    if (existing.length === 0) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      await db.query(
        `INSERT INTO campaign_settings (name, start_date, end_date) VALUES ($1, $2, $3)`,
        ['Copa GD 2026', firstDay, lastDay]
      );
      console.log('[Seed] Campanha padrão criada:', firstDay, '→', lastDay);
    }
  } catch (err) {
    console.error('[Seed] Erro:', err.message);
  }
}

module.exports = { seed };
