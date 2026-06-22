const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, canAccessGroup, isMasterAdmin } = require('../middleware/auth');
const { getManagedGroupIds } = require('../services/adminScopes');
const {
  uploadPhoto,
  GROUP_PUBLIC_COLUMNS,
  saveGroupPhoto,
  serveGroupPhoto,
  photoSaveError,
} = require('../services/groupPhotoStorage');
const {
  isBusinessDay,
  filterByWeekdayCadastro,
  isWeekdayPaid,
} = require('../utils/businessDays');

// GET /api/groups - listar todos os grupos com pontuação
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url, g.created_at, g.daily_goal_value, g.weekly_goal_value, g.goal_points,
        COUNT(DISTINCT gm.user_id) as member_count,
        COALESCE(se_agg.total_points, 0) + COALESCE(pa_agg.adj_points, 0) as total_points,
        COALESCE(se_agg.today_points, 0) as today_points
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(points) as total_points,
          SUM(CASE WHEN event_date = CURRENT_DATE THEN points ELSE 0 END) as today_points
        FROM score_events se
        WHERE se.group_id = g.id
          AND se.event_date >= COALESCE(
            (SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1),
            CURRENT_DATE
          )
          AND se.event_date <= CURRENT_DATE
      ) se_agg ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(points), 0) as adj_points
        FROM point_adjustments pa
        WHERE pa.group_id = g.id
      ) pa_agg ON true
      WHERE g.active = true
      GROUP BY g.id, g.name, g.photo_url, g.created_at, g.daily_goal_value, g.weekly_goal_value, g.goal_points,
               se_agg.total_points, se_agg.today_points, pa_agg.adj_points
      ORDER BY total_points DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
});

// GET /api/groups/ranking — ranking por período da campanha (público)
router.get('/ranking', async (req, res) => {
  try {
    // Período: query params ou busca na campanha configurada
    let { start, end } = req.query;

    if (!start || !end) {
      const { rows: camp } = await db.query(
        'SELECT start_date, end_date, name FROM campaign_settings ORDER BY id DESC LIMIT 1'
      );
      if (camp.length > 0) {
        const fmtD = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
        start = fmtD(camp[0].start_date);
        end   = fmtD(camp[0].end_date);
      } else {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      }
    }

    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url, g.daily_goal_value, g.weekly_goal_value, g.goal_points,
        COUNT(DISTINCT gm.user_id)::int AS member_count,
        COALESCE((
          SELECT SUM(se.points) FROM score_events se
          WHERE se.group_id = g.id AND se.event_date BETWEEN $1 AND $2
        ), 0) + COALESCE((
          SELECT SUM(pa.points) FROM point_adjustments pa
          WHERE pa.group_id = g.id AND pa.adjustment_date BETWEEN $1 AND $2
        ), 0) AS total_points
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      WHERE g.active = true
      GROUP BY g.id, g.name, g.photo_url, g.daily_goal_value, g.weekly_goal_value, g.goal_points
      ORDER BY total_points DESC
    `, [start, end]);

    // Buscar campanha para o frontend
    const { rows: camp } = await db.query(
      'SELECT id, name, start_date, end_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );

    const fmt = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

    const campaign = camp[0]
      ? { ...camp[0], start_date: fmt(camp[0].start_date), end_date: fmt(camp[0].end_date) }
      : null;

    res.json({
      groups: rows,
      campaign,
      period: { start: fmt(start), end: fmt(end) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar ranking' });
  }
});

// GET /api/groups/:id/members/points — pontos acumulados por dia (lê de score_events)
router.get('/:id/members/points', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // Grupo
    const { rows: grRows } = await db.query(
      'SELECT id, name FROM groups WHERE id = $1 AND active = true', [id]
    );
    if (!grRows.length) return res.status(404).json({ error: 'Grupo não encontrado' });

    // Período da campanha
    const { rows: campRows } = await db.query(
      'SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );
    const campaignStart = campRows[0]
      ? new Date(campRows[0].start_date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Jogos do Brasil com pontos dobrados no período
    const { rows: brazilMatches } = await db.query(
      `SELECT match_date, opponent, stage, description
       FROM brazil_matches
       WHERE match_date BETWEEN $1 AND CURRENT_DATE AND double_points = true`,
      [campaignStart]
    );
    const matchByDate = new Map();
    for (const m of brazilMatches) {
      const d = new Date(m.match_date).toISOString().slice(0, 10);
      matchByDate.set(d, {
        opponent: m.opponent,
        stage: m.stage,
        description: m.description,
      });
    }

    // score_events do grupo desde o início da campanha
    const { rows: events } = await db.query(
      `SELECT event_date, rule_name, points, description, is_double_points
       FROM score_events
       WHERE group_id = $1 AND event_date >= $2
       ORDER BY event_date DESC, rule_name`,
      [id, campaignStart]
    );

    // Ajustes manuais
    const { rows: adjs } = await db.query(
      `SELECT adjustment_date::text AS date, points, reason
       FROM point_adjustments WHERE group_id = $1 ORDER BY adjustment_date DESC`,
      [id]
    );

    const RULE_META = {
      META_DIA:           { icon: '🎯', label: 'Meta do Dia' },
      META_SEMANA:        { icon: '📅', label: 'Meta da Semana' },
      CONVERSAO:          { icon: '📈', label: 'Taxa de Conversão' },
      INDICACAO:          { icon: '👥', label: 'Indicações' },
      CONTRATO_10K:       { icon: '💰', label: 'Contratos 10K' },
      GOL_DE_PLACA:       { icon: '⚽', label: 'Gol de Placa' },
      TORCIDA_ORGANIZADA: { icon: '🎉', label: 'Torcida Organizada' },
      ARTILHEIRO:         { icon: '🏆', label: 'Artilheiro' },
    };

    // Agrupar por data
    const dayMap = new Map();
    for (const e of events) {
      const d = new Date(e.event_date).toISOString().slice(0, 10);
      if (!dayMap.has(d)) dayMap.set(d, []);
      dayMap.get(d).push({
        rule_name:  e.rule_name,
        points:     Number(e.points),
        base_points: e.is_double_points ? Number(e.points) / 2 : Number(e.points),
        multiplier: e.is_double_points ? 2 : 1,
        description: e.description,
        is_double:  e.is_double_points,
        icon:       RULE_META[e.rule_name]?.icon  || '⭐',
        label:      RULE_META[e.rule_name]?.label || e.rule_name,
      });
    }

    const days = [...dayMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, evs]) => ({
        date,
        events: evs,
        daily_total: evs.reduce((s, e) => s + e.points, 0),
        brazil_match: matchByDate.get(date) || null,
        is_double_day: matchByDate.has(date),
      }));

    const total_points = events.reduce((s, e) => s + Number(e.points), 0);
    const adj_total    = adjs.reduce((s, a) => s + Number(a.points), 0);

    res.json({
      days,
      adjustments: adjs.map(a => ({ ...a, date: String(a.date).slice(0, 10) })),
      total_points,
      adj_total,
      grand_total: total_points + adj_total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar pontos' });
  }
});

// GET /api/groups/:id/members/stats — contribuição individual dos membros
router.get('/:id/members/stats', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const weekend = !isBusinessDay(date);

    // Grupo
    const { rows: groupRows } = await db.query(
      'SELECT id, name, photo_url FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (groupRows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });

    // Membros com corban_id
    const { rows: members } = await db.query(
      `SELECT u.id, u.display_name, u.corban_id, gm.is_captain
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true`,
      [id]
    );

    const withCorban = members.filter(m => m.corban_id);
    const corbanIds  = withCorban.map(m => String(m.corban_id));

    // Buscar dados externos (com fallback se NewCorban não responder)
    const externalApi = require('../services/externalApi');
    let vendorMap   = {};
    let allProposals = [];

    if (corbanIds.length > 0 && !weekend) {
      try {
        const rankingData = await externalApi.getRanking(date, date);
        if (rankingData?.result) {
          Object.values(rankingData.result).forEach(v => {
            if (v.filter_value) vendorMap[String(v.filter_value)] = v;
          });
        }
      } catch (_) {}

      try {
        const proposalsData = await externalApi.getProposals(date, date, corbanIds);
        allProposals = filterByWeekdayCadastro(proposalsData ? Object.values(proposalsData) : []);
      } catch (_) {}
    }

    // Stats por membro
    const memberStats = members.map(m => {
      const cid    = m.corban_id ? String(m.corban_id) : null;
      const vendor = cid && !weekend ? (vendorMap[cid] || {}) : {};
      const mProps = cid && !weekend ? allProposals.filter(p => String(p.vendedor_id) === cid) : [];
      const paid   = mProps.filter(isWeekdayPaid);
      const valor  = mProps.reduce((s, p) => s + parseFloat(p.proposta?.valor_referencia || 0), 0);

      return {
        id:              m.id,
        display_name:    m.display_name,
        corban_id:       m.corban_id || null,
        is_captain:      m.is_captain,
        qtd_propostas:   parseInt(vendor.qtd_propostas || 0),
        valor_referencia: parseFloat(valor.toFixed(2)),
        contratos_pagos: paid.length,
      };
    });

    // Ordenar por valor_referencia desc
    memberStats.sort((a, b) => b.valor_referencia - a.valor_referencia);

    const totals = memberStats.reduce((acc, m) => ({
      qtd_propostas:    acc.qtd_propostas    + m.qtd_propostas,
      valor_referencia: acc.valor_referencia + m.valor_referencia,
      contratos_pagos:  acc.contratos_pagos  + m.contratos_pagos,
    }), { qtd_propostas: 0, valor_referencia: 0, contratos_pagos: 0 });

    res.json({ group: groupRows[0], date, is_business_day: !weekend, members: memberStats, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar stats dos membros' });
  }
});

// GET /api/groups/:id/photo — imagem da equipe (público; armazenada no PostgreSQL)
router.get('/:id/photo', serveGroupPhoto);

// GET /api/groups/:id - detalhes do grupo
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: groupRows } = await db.query(
      `SELECT ${GROUP_PUBLIC_COLUMNS} FROM groups WHERE id = $1 AND active = true`,
      [id]
    );
    if (groupRows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });

    const group = groupRows[0];

    // Membros
    const { rows: members } = await db.query(
      `SELECT u.id, u.username, u.corban_username, u.display_name, u.corban_id, u.corban_name, gm.is_captain, gm.joined_at
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true`,
      [id]
    );

    // Pontuação total e hoje (filtrado pelo período da campanha)
    const { rows: scoreRows } = await db.query(
      `SELECT
        COALESCE(SUM(points), 0) as total_points,
        COALESCE(SUM(CASE WHEN event_date = CURRENT_DATE THEN points ELSE 0 END), 0) as today_points,
        COALESCE(SUM(CASE WHEN event_date >= date_trunc('week', CURRENT_DATE) THEN points ELSE 0 END), 0) as week_points
       FROM score_events
       WHERE group_id = $1
         AND event_date >= (SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1)`,
      [id]
    );

    const { rows: adjRows } = await db.query(
      `SELECT COALESCE(SUM(points), 0) as adj_total FROM point_adjustments WHERE group_id = $1`,
      [id]
    );

    // Histórico de eventos recentes
    const { rows: events } = await db.query(
      `SELECT * FROM score_events WHERE group_id = $1 ORDER BY event_date DESC, created_at DESC LIMIT 30`,
      [id]
    );

    // Ajustes manuais recentes
    const { rows: adjustments } = await db.query(
      `SELECT pa.*, u.display_name as admin_name
       FROM point_adjustments pa
       JOIN users u ON pa.admin_id = u.id
       WHERE pa.group_id = $1
       ORDER BY pa.created_at DESC LIMIT 10`,
      [id]
    );

    const score = scoreRows[0];
    const totalPoints = parseFloat(score.total_points) + parseFloat(adjRows[0].adj_total);

    res.json({
      ...group,
      members,
      score: {
        total: totalPoints,
        today: parseFloat(score.today_points),
        week: parseFloat(score.week_points),
      },
      events,
      adjustments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar grupo' });
  }
});

// POST /api/groups - criar grupo (apenas admin master)
router.post('/', authMiddleware, uploadPhoto('photo'), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas o administrador master pode criar equipes' });
  }

  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nome do grupo deve ter pelo menos 2 caracteres' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING ${GROUP_PUBLIC_COLUMNS}`,
      [name.trim(), req.user.id]
    );

    const group = rows[0];
    if (req.file) {
      try {
        await saveGroupPhoto(group.id, req.file.buffer, req.file.mimetype);
        group.photo_url = `/api/groups/${group.id}/photo`;
      } catch (err) {
        return photoSaveError(err, res);
      }
    }

    res.status(201).json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar grupo' });
  }
});

// POST /api/groups/:id/join - desabilitado (admin gerencia equipes)
router.post('/:id/join', authMiddleware, async (req, res) => {
  return res.status(403).json({ error: 'Entrada em equipes é feita pelo administrador' });
});

// POST /api/groups/:id/leave - desabilitado (admin gerencia equipes)
router.post('/:id/leave', authMiddleware, async (req, res) => {
  return res.status(403).json({ error: 'Saída de equipes é feita pelo administrador' });
});

// PUT /api/groups/:id - atualizar grupo
router.put('/:id', authMiddleware, uploadPhoto('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // Verificar permissão: master, sub-admin do escopo ou capitão
    if (req.user.role === 'team_admin') {
      req.managedGroupIds = await getManagedGroupIds(req.user.id);
      if (!canAccessGroup(req, id)) {
        return res.status(403).json({ error: 'Sem permissão para esta equipe' });
      }
    } else if (req.user.role !== 'admin') {
      const { rows } = await db.query(
        'SELECT id FROM group_memberships WHERE user_id = $1 AND group_id = $2 AND is_captain = true',
        [req.user.id, id]
      );
      if (rows.length === 0) {
        return res.status(403).json({ error: 'Apenas o capitão pode editar o grupo' });
      }
    }

    if (name) {
      await db.query(
        'UPDATE groups SET name = $1, updated_at = NOW() WHERE id = $2',
        [name.trim(), id]
      );
    }
    if (req.file) {
      try {
        await saveGroupPhoto(id, req.file.buffer, req.file.mimetype);
      } catch (err) {
        return photoSaveError(err, res);
      }
    }

    if (!name && !req.file) return res.status(400).json({ error: 'Nada para atualizar' });

    const { rows } = await db.query(
      `SELECT ${GROUP_PUBLIC_COLUMNS} FROM groups WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Grupo não encontrado' });

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar grupo' });
  }
});

module.exports = router;
