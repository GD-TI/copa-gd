const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { calculateScores } = require('../services/scoring');
const { broadcast } = require('./events');

// GET /api/scores/leaderboard - placar geral
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url,
        COUNT(DISTINCT gm.user_id) as member_count,
        COALESCE(se_agg.event_points, 0) as event_points,
        COALESCE(pa_agg.adj_points, 0) as adj_points,
        COALESCE(se_agg.event_points, 0) + COALESCE(pa_agg.adj_points, 0) as total_points,
        COALESCE(se_agg.today_points, 0) as today_points,
        COALESCE(se_agg.week_points, 0) as week_points
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(points) as event_points,
          SUM(CASE WHEN event_date = CURRENT_DATE THEN points ELSE 0 END) as today_points,
          SUM(CASE WHEN event_date >= date_trunc('week', CURRENT_DATE)::date THEN points ELSE 0 END) as week_points
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
      GROUP BY g.id, g.name, g.photo_url,
               se_agg.event_points, se_agg.today_points, se_agg.week_points,
               pa_agg.adj_points
      ORDER BY total_points DESC, today_points DESC
    `);

    const rankedGroups = rows.map((g, idx) => ({
      ...g,
      rank: idx + 1,
      total_points: parseFloat(g.total_points),
      today_points: parseFloat(g.today_points),
      week_points: parseFloat(g.week_points),
    }));

    res.json(rankedGroups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar placar' });
  }
});

// GET /api/scores/today-events - eventos de hoje
router.get('/today-events', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT se.*, g.name as group_name, g.photo_url as group_photo
      FROM score_events se
      JOIN groups g ON se.group_id = g.id
      WHERE se.event_date = CURRENT_DATE
      ORDER BY se.points DESC, se.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar eventos de hoje' });
  }
});

// GET /api/scores/history/:groupId - histórico de pontuação do grupo
router.get('/history/:groupId', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { rows } = await db.query(
      `SELECT event_date, rule_name, points, description, is_double_points
       FROM score_events WHERE group_id = $1
       ORDER BY event_date DESC, created_at DESC`,
      [groupId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// GET /api/scores/rules - regras de pontuação
router.get('/rules', authMiddleware, (req, res) => {
  res.json([
    { name: 'META_DIA', label: 'Meta do Dia', points: 5, description: 'Grupo atinge a meta diária de propostas', icon: '🎯' },
    { name: 'META_SEMANA', label: 'Meta da Semana', points: 10, description: 'Grupo atinge a meta semanal de propostas', icon: '📅' },
    { name: 'INDICACAO', label: 'Vendas por Indicação', points: '10 / 5 contratos', description: 'A cada 5 contratos pagos de indicação', icon: '👥' },
    { name: 'CONTRATO_10K', label: 'Contrato Acima de 10K', points: 5, description: 'Por contrato com valor de referência acima de R$ 10.000', icon: '💰' },
    { name: 'GOL_DE_PLACA', label: 'Gol de Placa', points: 15, description: 'Grupo com o maior contrato individual do dia', icon: '⚽' },
    { name: 'TORCIDA_ORGANIZADA', label: 'Torcida Organizada', points: 20, description: 'Todos os 5 integrantes fecharam mais de 10 propostas no dia', icon: '🎉' },
    { name: 'ARTILHEIRO', label: 'Artilheiro da Rodada', points: 15, description: 'Grupo com o maior número de contratos pagos no dia', icon: '🏆' },
    { name: 'AJUSTE_ADMIN', label: 'Ajuste do Administrador', points: 'variável', description: 'Pontos atribuídos ou removidos manualmente pelo admin', icon: '⚙️' },
  ]);
});

// POST /api/scores/calculate - disparar cálculo manual (admin)
router.post('/calculate', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem calcular pontuações' });
  }

  try {
    const events = await calculateScores(req.user.id);
    broadcast('scores_updated', { ts: Date.now() });
    res.json({
      message: 'Cálculo realizado com sucesso',
      date: new Date().toISOString().split('T')[0],
      events_count: events.length,
      events,
    });
  } catch (err) {
    console.error('Erro no cálculo:', err);
    res.status(500).json({ error: `Erro no cálculo: ${err.message}` });
  }
});

module.exports = router;
