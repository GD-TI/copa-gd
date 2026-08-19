const db = require('../config/db');

/**
 * Virada de nome: "Copa GD 2026" (a competição por equipes, encerrada em
 * 31/07/2026) deixa de dar nome à plataforma — o produto passa a se chamar
 * "Ranking GD". O default da coluna já mudou em seed.js, mas isso só vale
 * para bancos novos; quem já tinha a linha em `campaign_settings` fica com
 * o nome antigo para sempre sem este UPDATE.
 *
 * Só renomeia se o valor ainda for exatamente o antigo — se o admin já
 * renomeou pelo painel (Configuração → Período da Campanha), essa escolha
 * não pode ser desfeita por deploy (mesmo cuidado do backfill de franquia_ids
 * logo abaixo).
 */
async function migrateCampaignSettingsName() {
  const { rowCount } = await db.query(`
    UPDATE campaign_settings SET name = 'Ranking GD', updated_at = NOW()
     WHERE name = 'Copa GD 2026'
  `);
  if (rowCount) console.log('[Migration] campaign_settings.name: "Copa GD 2026" → "Ranking GD"');
}

/**
 * Papéis aceitos em `users.role`. Fonte única: a constraint do banco é gerada a
 * partir desta lista, e não escrita à mão em cada migration — foi o que fez o
 * `team_admin` precisar de SQL manual em produção quando a constraint antiga
 * ainda listava só dois papéis.
 */
const ROLES_PERMITIDOS = ['player', 'admin', 'team_admin', 'franqueado'];

/**
 * Reescreve a CHECK de `users.role` quando falta algum papel da lista.
 *
 * Idempotente e conservadora: se todos os papéis já estão na definição atual,
 * não toca em nada. Devolve `true` quando reescreveu.
 */
async function garantirRolesPermitidos() {
  const { rows: checks } = await db.query(`
    SELECT c.conname,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.users'::regclass
      AND c.contype = 'c'
      AND a.attname = 'role'
  `);

  const faltando = ROLES_PERMITIDOS.filter(
    role => !checks.some(c => String(c.def).includes(`'${role}'`))
  );
  if (checks.length && faltando.length === 0) return false;

  for (const { conname } of checks) {
    await db.query(`ALTER TABLE users DROP CONSTRAINT "${conname}"`);
  }
  const lista = ROLES_PERMITIDOS.map(r => `'${r}'`).join(', ');
  try {
    await db.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN (${lista}))
    `);
  } catch (err) {
    if (err.code !== '42710') throw err;
  }
  console.log(`[Migration] users.role: papéis habilitados — ${ROLES_PERMITIDOS.join(', ')}`);
  return true;
}

/** Permite role team_admin + tabela admin_team_scopes (idempotente). */
async function migrateTeamAdminSupport() {
  await garantirRolesPermitidos();

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

/**
 * Dono de franquia (`franqueado`): cria e administra as campanhas da própria
 * unidade, sem enxergar nem tocar nas das outras.
 *
 * O escopo é uma tabela própria, e não uma coluna em `users`, por dois motivos:
 * um dono pode responder por mais de uma unidade, e o vínculo precisa ser
 * decidido pela matriz — derivar do cadastro do NewCorban faria consultor com
 * `franquia_id` nulo virar dono da matriz por acidente.
 *
 * `franquia_id` é VARCHAR porque o identificador vem do NewCorban como texto e
 * inclui o token `'matriz'` (a matriz é a AUSÊNCIA de franquia, não um id — ver
 * services/franquiaSellers.js). Sem FK, portanto: não existe tabela local de
 * franquias, o catálogo é o cadastro do NewCorban.
 */
async function migrateFranquiaOwners() {
  await garantirRolesPermitidos();

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_franquia_scopes (
      user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      franquia_id VARCHAR(50) NOT NULL,
      created_at  TIMESTAMP   DEFAULT NOW(),
      PRIMARY KEY (user_id, franquia_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_franquia_scopes_user ON admin_franquia_scopes(user_id)
  `);

  // Franquia dona da campanha. NULL = criada pela matriz (abrangência livre).
  // É o que separa "minha campanha" de "campanha que a matriz mandou para mim":
  // as duas aparecem para o franqueado, só a primeira ele edita.
  await db.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS owner_franquia_id VARCHAR(50)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_owner_franquia ON campaigns(owner_franquia_id)
  `);
}

/**
 * Campanhas como entidade de verdade (a `campaign_settings` é uma linha única
 * editada no lugar, sem histórico). Uma campanha é um recorte de período sobre
 * o ranking — não um motor de pontos paralelo.
 */
async function migrateCampaigns() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      subtitle VARCHAR(200),
      start_date DATE,
      end_date DATE,
      color VARCHAR(20) NOT NULL DEFAULT 'azul',
      metric VARCHAR(20) NOT NULL DEFAULT 'contratos',
      product_ids TEXT[] NOT NULL DEFAULT ARRAY['13'],
      require_same_day BOOLEAN NOT NULL DEFAULT false,
      ladder JSONB NOT NULL DEFAULT '[]'::jsonb,
      ladder_step JSONB,
      spin_every INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      legacy_kind VARCHAR(20),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`);

  // Franquias que participam. NULL = empresa inteira (comportamento anterior).
  await db.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS franquia_ids TEXT[]`);

  // Foto congelada de uma campanha do sistema antigo (equipes/score_events), marcada
  // por legacy_kind. Ver POST /api/campaigns/archive-legacy em routes/campaigns.js.
  await db.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS legacy_snapshot JSONB`);

  // Classificação congelada no encerramento — o histórico não pode mudar se a API mudar
  await db.query(`
    CREATE TABLE IF NOT EXISTS campaign_results (
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      vendor_id VARCHAR(50) NOT NULL,
      vendor_name VARCHAR(150),
      contracts INTEGER NOT NULL DEFAULT 0,
      total_value NUMERIC NOT NULL DEFAULT 0,
      prize_value NUMERIC NOT NULL DEFAULT 0,
      spins INTEGER NOT NULL DEFAULT 0,
      frozen_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (campaign_id, position)
    )
  `);

  // Equipe do vendedor no momento do congelamento, e o diagnóstico do dia — sem
  // eles o telão de campanha encerrada perde a linha "N contratos não entraram".
  await db.query(`ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS team VARCHAR(150)`);
  await db.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS frozen_diagnostics JSONB`);

  // Próximo degrau da escada, congelado junto com o resto. `campaignFreezer.js`
  // já calculava next_at/next_prize/missing na hora de congelar (via
  // montarPlacar) e os descartava, obrigando `lerCongelado` a recalculá-los a
  // partir de campaigns.ladder — que é um campo AO VIVO. Editar a escada de uma
  // campanha encerrada mudava esses três valores no placar histórico enquanto
  // prize_value/spins (esses sim gravados) ficavam intocados, produzindo uma
  // combinação sem sentido: prêmio já pago de um jeito, "próximo prêmio" de outro.
  //
  // `frozen_date` é o discriminador de compatibilidade: só passa a existir a
  // partir desta migration, então uma linha antiga (congelada antes dela) tem
  // `frozen_date IS NULL` e continua caindo no recálculo ao vivo — o snapshot já
  // gravado não muda de comportamento sozinho. Só um novo congelamento (ou um
  // "Recongelar") preenche `frozen_date` e passa a valer o valor travado.
  await db.query(`ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS next_at INTEGER`);
  await db.query(`ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS next_prize NUMERIC`);
  await db.query(`ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS missing INTEGER`);
  await db.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS frozen_date DATE`);

  // Contas não-humanas fora do placar (a IA é a linha de base, não concorrente)
  await db.query(`
    CREATE TABLE IF NOT EXISTS ranking_exclusions (
      id SERIAL PRIMARY KEY,
      corban_id VARCHAR(50),
      name_pattern VARCHAR(150),
      reason TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const { rows: exc } = await db.query(`SELECT COUNT(*)::int AS n FROM ranking_exclusions`);
  if (exc[0].n === 0) {
    await db.query(`
      INSERT INTO ranking_exclusions (name_pattern, reason) VALUES
        ('API%',        'Integração / IA — produz vendas sem consultor humano'),
        ('%(Matriz)%',  'Conta de matriz, não é consultor'),
        ('BOT %',       'Robô'),
        ('ROBO%',       'Robô'),
        ('ROBÔ%',       'Robô')
    `);
    console.log('[Migration] ranking_exclusions: padrões padrão inseridos');
  }

  // Missão Resgate — escada e roleta conforme o documento da campanha.
  // Campanha de um dia: 10/08/2026. Já entra ativa e com data para não depender
  // de configuração manual no dia em que ela acontece.
  const { rows: mr } = await db.query(`SELECT id FROM campaigns WHERE name = 'Missão Resgate'`);
  if (mr.length === 0) {
    await db.query(`
      INSERT INTO campaigns
        (name, subtitle, start_date, end_date, color, metric, product_ids, require_same_day,
         franquia_ids, ladder, ladder_step, spin_every, status)
      VALUES
        ('Missão Resgate',
         'A IA fez a parte dela. Agora começa a nossa.',
         DATE '2026-08-10', DATE '2026-08-10',
         'laranja', 'contratos', ARRAY['13'], true,
         ARRAY['matriz'], $1::jsonb, $2::jsonb, 5, 'active')
    `, [
      JSON.stringify([
        { at: 5,  prize: 20 },
        { at: 10, prize: 20 },
        { at: 15, prize: 30 },
        { at: 20, prize: 40 },
        { at: 25, prize: 50 },
      ]),
      JSON.stringify({ every: 5, prize: 20 }),
    ]);
    console.log('[Migration] campanha "Missão Resgate" criada e ativa para 10/08/2026');
  } else {
    // Cobre o caso de uma versão anterior desta migration ter criado a campanha sem data
    const { rowCount } = await db.query(`
      UPDATE campaigns
         SET start_date = DATE '2026-08-10',
             end_date   = DATE '2026-08-10',
             status     = 'active',
             updated_at = NOW()
       WHERE name = 'Missão Resgate' AND start_date IS NULL
    `);
    if (rowCount) console.log('[Migration] "Missão Resgate": data definida para 10/08/2026');
  }

  // Campanha só da matriz — que no NewCorban é quem NÃO tem franquia_id.
  // Só preenche se ninguém decidiu ainda: escolha feita no painel não pode ser
  // desfeita por deploy. Corrige também quem já gravou ARRAY['1'] (Franquia
  // Mauá, desativada desde 2024) por causa da suposição inicial errada.
  const { rowCount: fr } = await db.query(`
    UPDATE campaigns SET franquia_ids = ARRAY['matriz'], updated_at = NOW()
     WHERE name = 'Missão Resgate'
       AND (franquia_ids IS NULL OR franquia_ids = ARRAY['1'])
  `);
  if (fr) console.log('[Migration] "Missão Resgate": restrita à matriz (consultor sem franquia)');
}

/**
 * Ranking individual mensal congelado.
 *
 * O ranking ao vivo não precisa de tabela nenhuma — a janela da consulta é o
 * mês, e a virada acontece sozinha. Esta tabela existe só para o histórico:
 * decisão do cliente (12/08/2026) de que o mês encerrado vira foto imutável,
 * "sem ficar alterando". Sem ela, um estorno lançado em setembro mudaria o
 * resultado de agosto retroativamente.
 */
async function migrateMonthlyRankings() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS monthly_rankings (
      month_ref    CHAR(7)      NOT NULL,
      position     INTEGER      NOT NULL,
      vendedor_id  VARCHAR(50)  NOT NULL,
      nome         VARCHAR(150),
      foto         TEXT,
      equipe       VARCHAR(150),
      franquia_nome VARCHAR(150),
      contratos    INTEGER      NOT NULL DEFAULT 0,
      valor        NUMERIC      NOT NULL DEFAULT 0,
      valor_meta   NUMERIC      NOT NULL DEFAULT 0,
      frozen_at    TIMESTAMP    DEFAULT NOW(),
      PRIMARY KEY (month_ref, position)
    )
  `);

  // Diagnóstico da leitura que virou a foto — sem ele não dá para saber depois
  // se um mês magro foi mês fraco ou filtro apertado.
  await db.query(`
    CREATE TABLE IF NOT EXISTS monthly_ranking_meta (
      month_ref   CHAR(7) PRIMARY KEY,
      inicio      DATE,
      fim         DATE,
      participantes INTEGER NOT NULL DEFAULT 0,
      contratos   INTEGER NOT NULL DEFAULT 0,
      valor       NUMERIC NOT NULL DEFAULT 0,
      diagnostics JSONB,
      frozen_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_monthly_rankings_mes ON monthly_rankings(month_ref)`
  );
}

module.exports = {
  ROLES_PERMITIDOS,
  garantirRolesPermitidos,
  migrateTeamAdminSupport,
  migrateFranquiaOwners,
  migrateCampaigns,
  migrateCampaignSettingsName,
  migrateMonthlyRankings,
};
