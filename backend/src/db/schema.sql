-- ===========================
-- COPA GD 2026 - Schema SQL
-- ===========================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Usuários (jogadores e administradores)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  corban_id VARCHAR(50),          -- id do usuário no NewCorban (= vendedor_id nas propostas)
  corban_username VARCHAR(100),   -- username de login no NewCorban
  corban_name VARCHAR(255),       -- nome completo no NewCorban
  corban_avatar_url VARCHAR(500), -- avatar_url do NewCorban
  display_name VARCHAR(150),      -- nome exibido no app
  active BOOLEAN DEFAULT true,
  needs_password_setup BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Grupos
CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  photo_url VARCHAR(500),
  created_by INTEGER REFERENCES users(id),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Membros dos grupos (um jogador só pode estar em 1 grupo)
CREATE TABLE IF NOT EXISTS group_memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) UNIQUE,
  group_id INTEGER REFERENCES groups(id),
  is_captain BOOLEAN DEFAULT false,
  joined_at TIMESTAMP DEFAULT NOW()
);

-- Metas por grupo (definidas pelo admin)
CREATE TABLE IF NOT EXISTS group_goals (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id),
  daily_goal INTEGER DEFAULT 0,    -- meta de propostas por dia
  weekly_goal INTEGER DEFAULT 0,   -- meta de propostas por semana
  set_by INTEGER REFERENCES users(id),
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Eventos de pontuação (histórico)
CREATE TABLE IF NOT EXISTS score_events (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id),
  event_date DATE NOT NULL,
  rule_name VARCHAR(50) NOT NULL,
  points NUMERIC NOT NULL,
  description TEXT,
  is_double_points BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(group_id, event_date, rule_name)
);

-- Ajustes manuais de pontos pelo admin
CREATE TABLE IF NOT EXISTS point_adjustments (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES groups(id),
  admin_id INTEGER REFERENCES users(id),
  points NUMERIC NOT NULL,
  reason TEXT NOT NULL,
  adjustment_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Jogos do Brasil na Copa 2026
CREATE TABLE IF NOT EXISTS brazil_matches (
  id SERIAL PRIMARY KEY,
  match_date DATE UNIQUE NOT NULL,
  opponent VARCHAR(100),
  stage VARCHAR(50),   -- 'group', 'round_of_16', 'quarter', 'semi', 'final'
  description VARCHAR(255),
  double_points BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Registro de cálculos diários (para não recalcular)
CREATE TABLE IF NOT EXISTS daily_calculations (
  id SERIAL PRIMARY KEY,
  calculation_date DATE UNIQUE NOT NULL,
  calculated_at TIMESTAMP DEFAULT NOW(),
  triggered_by INTEGER REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'completed'
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_score_events_group_date ON score_events(group_id, event_date);
CREATE INDEX IF NOT EXISTS idx_score_events_date ON score_events(event_date);
CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_group_goals_group ON group_goals(group_id);
CREATE INDEX IF NOT EXISTS idx_point_adjustments_group ON point_adjustments(group_id);

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Configurações da campanha (período, nome)
CREATE TABLE IF NOT EXISTS campaign_settings (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL DEFAULT 'Copa GD 2026',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Admin padrão é criado pelo script de inicialização do Node.js (src/db/seed.js)
-- Senha padrão: admin2026 (mudar após primeiro acesso)

-- Pontos configuráveis por regra de pontuação
CREATE TABLE IF NOT EXISTS scoring_rules (
  rule_name VARCHAR(50) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10) DEFAULT '⭐',
  base_points NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);
