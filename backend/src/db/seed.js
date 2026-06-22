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

    // Migrations idempotentes — executadas individualmente para não bloquear as demais
    const migrations = [
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS daily_goal_value  NUMERIC DEFAULT 0`,
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS weekly_goal_value NUMERIC DEFAULT 0`,
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS goal_points       INTEGER DEFAULT 0`,
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_data       BYTEA`,
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_mime       VARCHAR(50)`,
      `ALTER TABLE users  ADD COLUMN IF NOT EXISTS needs_password_setup BOOLEAN DEFAULT false`,
    ];
    for (const sql of migrations) {
      try { await db.query(sql); } catch (_) { /* coluna já existe ou sem permissão de owner */ }
    }

    // Pontos configuráveis por regra
    await db.query(`
      CREATE TABLE IF NOT EXISTS scoring_rules (
        rule_name VARCHAR(50) PRIMARY KEY,
        label VARCHAR(100) NOT NULL,
        description TEXT,
        icon VARCHAR(10) DEFAULT '⭐',
        base_points NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const defaultRules = [
      ['META_DIA',           'Meta do Dia',           'Grupo atinge a meta diária de valor referência (contratos pagos)', '🎯', 5],
      ['META_SEMANA',        'Meta da Semana',        'Grupo atinge a meta semanal de valor referência',                '📅', 10],
      ['CONVERSAO',          'Taxa de Conversão',     'Taxa de pagamento do dia >= 80%',                                '📈', 5],
      ['INDICACAO',          'Vendas por Indicação',  'A cada 5 contratos pagos em que origem contém "Indicação"',        '👥', 10],
      ['CONTRATO_10K',       'Contrato Acima de 10K', 'Por contrato com valor_referencia > R$ 10.000',                  '💰', 5],
      ['GOL_DE_PLACA',       'Gol de Placa',          'Grupo com o maior contrato pago do dia',                         '⚽', 15],
      ['TORCIDA_ORGANIZADA', 'Torcida Organizada',    'Todos os integrantes com >10 propostas no dia',                  '🎉', 20],
      ['ARTILHEIRO',         'Artilheiro',            'Grupo com mais contratos pagos no dia',                          '🏆', 15],
    ];
    for (const [name, label, desc, icon, pts] of defaultRules) {
      await db.query(
        `INSERT INTO scoring_rules (rule_name, label, description, icon, base_points)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (rule_name) DO UPDATE SET
           label = EXCLUDED.label,
           description = EXCLUDED.description,
           icon = EXCLUDED.icon`,
        [name, label, desc, icon, pts]
      );
    }

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
    if (err.code === 'ENOTFOUND') {
      const host = require('../config/validateDb').parseDbHost(process.env.DATABASE_URL);
      console.error(
        `[Seed] Erro: não foi possível resolver o host do banco "${host}". ` +
        'Verifique DATABASE_URL no painel da Hostinger (host, usuário e senha reais).'
      );
    } else if (err.code === 'ECONNREFUSED') {
      console.error('[Seed] Erro: conexão recusada. Confira host, porta (5432) e se o PostgreSQL aceita conexões externas.');
    } else if (err.code === '42P01') {
      console.error('[Seed] Erro: tabela não existe. Execute backend/src/db/schema.sql no banco antes do primeiro deploy.');
    } else {
      console.error('[Seed] Erro:', err.message);
    }
  }
}

module.exports = { seed };
