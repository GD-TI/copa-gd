const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { calculateScores } = require('../services/scoring');
const { broadcast } = require('./events');
const { getRulesList } = require('../services/scoringRules');
const { getProposals } = require('../services/externalApi');
const { isIndicacaoProposal } = require('../utils/proposals');
const { getCadastroDateStr, isWeekdayPaid } = require('../utils/businessDays');

// GET /api/scores/leaderboard - placar geral
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url, g.goal_points,
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
      GROUP BY g.id, g.name, g.photo_url, g.goal_points,
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

// GET /api/scores/rules - regras de pontuação (lê do banco)
router.get('/rules', authMiddleware, async (req, res) => {
  try {
    const rules = await getRulesList();
    res.json([
      ...rules.map(r => ({
        name: r.name,
        label: r.label,
        points: r.points,
        description: r.description,
        icon: r.icon,
      })),
      { name: 'AJUSTE_ADMIN', label: 'Ajuste do Administrador', points: 'variável', description: 'Pontos atribuídos ou removidos manualmente pelo admin', icon: '⚙️' },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar regras' });
  }
});

// GET /api/scores/individual-rankings - top 3 melhor vendedor e rei das assistências
router.get('/individual-rankings', authMiddleware, async (req, res) => {
  try {
    const { rows: cs } = await db.query(
      'SELECT start_date, end_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );
    if (!cs[0]) return res.json({ melhor_vendedor: [], rei_assistencias: [] });

    const startDate = new Date(cs[0].start_date).toISOString().slice(0, 10);
    const endRaw    = new Date(cs[0].end_date).toISOString().slice(0, 10);
    const today     = new Date().toISOString().slice(0, 10);
    const endDate   = endRaw < today ? endRaw : today;

    // Apenas vendedores presentes em equipes ativas
    const { rows: activeMembers } = await db.query(`
      SELECT DISTINCT u.corban_id
      FROM users u
      JOIN group_memberships gm ON u.id = gm.user_id
      JOIN groups g ON gm.group_id = g.id
      WHERE g.active = true AND u.active = true AND u.corban_id IS NOT NULL
    `);
    const activeCorbans = new Set(activeMembers.map(r => String(r.corban_id)));

    const proposalsMap = await getProposals(startDate, endDate);
    const proposals    = Object.values(proposalsMap || {});

    // Apenas propostas pagas de vendedores em equipes ativas
    const paid = proposals.filter(p => p?.datas?.pagamento && activeCorbans.has(String(p.vendedor_id)));

    // Agrupa por vendedor_id
    const byVendor = {};
    for (const p of paid) {
      const vid = String(p.vendedor_id);
      if (!byVendor[vid]) byVendor[vid] = { vendedor_id: vid, total_valor: 0, indicacao_count: 0 };
      byVendor[vid].total_valor    += parseFloat(p.proposta?.valor_referencia || 0);
      if (isIndicacaoProposal(p)) byVendor[vid].indicacao_count++;
    }

    const vendorList = Object.values(byVendor);

    const topVendor       = [...vendorList].sort((a, b) => b.total_valor - a.total_valor);
    const topAssistencias = vendorList.filter(v => v.indicacao_count > 0)
                              .sort((a, b) => b.indicacao_count - a.indicacao_count);

    // Resolve nomes via DB (corban_id → display_name)
    const allVids = [...new Set([...topVendor, ...topAssistencias].map(v => v.vendedor_id))];
    const nameMap = {};
    if (allVids.length > 0) {
      const { rows: uRows } = await db.query(
        'SELECT corban_id, display_name, corban_username FROM users WHERE corban_id = ANY($1) AND active = true',
        [allVids]
      );
      uRows.forEach(u => { nameMap[String(u.corban_id)] = u.display_name || u.corban_username; });
    }

    const enrich = (v, rank) => ({
      rank: rank + 1,
      name: nameMap[v.vendedor_id] || `Vendedor ${v.vendedor_id}`,
      vendedor_id: v.vendedor_id,
      total_valor: Math.round(v.total_valor * 100) / 100,
      indicacao_count: v.indicacao_count,
    });

    res.json({
      melhor_vendedor:   topVendor.map(enrich),
      rei_assistencias:  topAssistencias.map(enrich),
    });
  } catch (err) {
    console.error('[IndividualRankings]', err.message);
    res.status(500).json({ error: 'Erro ao buscar rankings individuais' });
  }
});

// GET /api/scores/today-activity - equipes e jogadores que pontuaram hoje
router.get('/today-activity', authMiddleware, async (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const { rows: eventRows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url,
        se.rule_name, se.points, se.description, se.is_double_points,
        sr.label, sr.icon,
        SUM(se.points) OVER (PARTITION BY g.id) AS today_total
      FROM score_events se
      JOIN groups g ON se.group_id = g.id
      LEFT JOIN scoring_rules sr ON se.rule_name = sr.rule_name
      WHERE se.event_date = $1 AND g.active = true
      ORDER BY today_total DESC, se.points DESC
    `, [todayStr]);

    const { rows: memberRows } = await db.query(`
      SELECT g.id AS group_id, u.corban_id, u.display_name
      FROM groups g
      JOIN group_memberships gm ON g.id = gm.group_id
      JOIN users u ON gm.user_id = u.id
      WHERE g.active = true AND u.active = true AND u.corban_id IS NOT NULL
    `);

    const groupMembers = {};
    memberRows.forEach(r => {
      if (!groupMembers[r.group_id]) groupMembers[r.group_id] = [];
      groupMembers[r.group_id].push({ corban_id: String(r.corban_id), name: r.display_name });
    });

    // Propostas do dia para stats por jogador (usa cache da campanha)
    const playerStats = {};
    try {
      const { rows: cs } = await db.query('SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1');
      const campaignStart = cs[0] ? new Date(cs[0].start_date).toISOString().slice(0, 10) : todayStr;
      const allCorbans = memberRows.map(r => r.corban_id).filter(Boolean);
      if (allCorbans.length > 0) {
        const pd = await getProposals(campaignStart, todayStr, allCorbans);
        Object.values(pd || {}).forEach(p => {
          if (getCadastroDateStr(p) !== todayStr) return;
          const vid = String(p.vendedor_id);
          if (!playerStats[vid]) playerStats[vid] = { valor: 0, contratos: 0, pagos: 0 };
          playerStats[vid].contratos++;
          if (isWeekdayPaid(p)) {
            playerStats[vid].pagos++;
            playerStats[vid].valor += parseFloat(p.proposta?.valor_referencia || 0);
          }
        });
      }
    } catch (e) {
      console.warn('[TodayActivity] proposals:', e.message);
    }

    const grouped = {};
    for (const row of eventRows) {
      if (!grouped[row.id]) {
        grouped[row.id] = {
          id: row.id, name: row.name, photo_url: row.photo_url,
          today_points: parseFloat(row.today_total),
          events: [],
          top_players: [],
        };
      }
      grouped[row.id].events.push({
        rule_name: row.rule_name,
        points: parseFloat(row.points),
        label: row.label || row.rule_name,
        icon: row.icon || '📊',
        description: row.description,
        is_double: row.is_double_points,
      });
    }

    for (const [gid, members] of Object.entries(groupMembers)) {
      if (!grouped[gid]) continue;
      grouped[gid].top_players = members
        .map(m => ({ name: m.name, ...(playerStats[m.corban_id] || { valor: 0, contratos: 0, pagos: 0 }) }))
        .filter(p => p.contratos > 0)
        .sort((a, b) => b.valor - a.valor || b.pagos - a.pagos)
        .slice(0, 5);
    }

    res.json({ date: todayStr, groups: Object.values(grouped) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar atividade do dia' });
  }
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
