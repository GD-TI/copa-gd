const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, adminOnly, configAdminOnly, attachManagedGroups, canAccessGroup, isMasterAdmin } = require('../middleware/auth');
const { getRulesList, invalidateRuleCache } = require('../services/scoringRules');

function fmtDate(d) {
  if (!d) return null;
  // Garante formato YYYY-MM-DD independente do que o postgres retornar
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// GET /api/settings/campaign — público
router.get('/campaign', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, start_date, end_date, updated_at FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nenhuma campanha configurada' });
    }
    const c = rows[0];
    res.json({
      ...c,
      start_date: fmtDate(c.start_date),
      end_date:   fmtDate(c.end_date),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// PUT /api/settings/campaign — admin only
router.put('/campaign', authMiddleware, adminOnly, async (req, res) => {
  const { name, start_date, end_date } = req.body;

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'Nome, data de início e data de fim são obrigatórios' });
  }

  if (new Date(end_date) <= new Date(start_date)) {
    return res.status(400).json({ error: 'Data de fim deve ser posterior à data de início' });
  }

  try {
    const { rows: existing } = await db.query('SELECT id FROM campaign_settings ORDER BY id DESC LIMIT 1');

    let row;
    if (existing.length > 0) {
      const { rows } = await db.query(
        `UPDATE campaign_settings SET name=$1, start_date=$2, end_date=$3, created_by=$4, updated_at=NOW()
         WHERE id=$5 RETURNING *`,
        [name.trim(), start_date, end_date, req.user.id, existing[0].id]
      );
      row = rows[0];
    } else {
      const { rows } = await db.query(
        `INSERT INTO campaign_settings (name, start_date, end_date, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [name.trim(), start_date, end_date, req.user.id]
      );
      row = rows[0];
    }

    res.json({
      ...row,
      start_date: fmtDate(row.start_date),
      end_date:   fmtDate(row.end_date),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

// PUT /api/settings/group-goals — admin master ou sub-admin (equipes do escopo)
router.put('/group-goals', authMiddleware, configAdminOnly, attachManagedGroups, async (req, res) => {
  const { goals } = req.body;

  if (!Array.isArray(goals) || goals.length === 0) {
    return res.status(400).json({ error: 'Lista de metas obrigatória' });
  }

  try {
    for (const g of goals) {
      if (!isMasterAdmin(req.user) && !canAccessGroup(req, g.group_id)) {
        return res.status(403).json({ error: `Sem permissão para equipe ${g.group_id}` });
      }
      const daily  = parseFloat(g.daily_goal_value  || 0) || 0;
      const weekly = parseFloat(g.weekly_goal_value || 0) || 0;
      const goal   = parseInt(g.goal_points         || 0) || 0;
      const meta2  = parseFloat(g.daily_goal_meta2  || 0) || 0;
      const meta3  = parseFloat(g.daily_goal_meta3  || 0) || 0;
      await db.query(
        `UPDATE groups
         SET daily_goal_value = $1, weekly_goal_value = $2, goal_points = $3,
             daily_goal_meta2 = $4, daily_goal_meta3 = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [daily, weekly, goal, meta2, meta3, g.group_id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar metas' });
  }
});

// GET /api/settings/scoring-rules — público (autenticado)
router.get('/scoring-rules', authMiddleware, async (req, res) => {
  try {
    const rules = await getRulesList();
    res.json(rules);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar regras' });
  }
});

// PUT /api/settings/scoring-rules — admin only
// Body: { rules: [{ rule_name, base_points }] }
router.put('/scoring-rules', authMiddleware, adminOnly, async (req, res) => {
  const { rules } = req.body;

  if (!Array.isArray(rules) || rules.length === 0) {
    return res.status(400).json({ error: 'Lista de regras obrigatória' });
  }

  try {
    for (const r of rules) {
      const pts = parseFloat(r.base_points);
      if (!r.rule_name || isNaN(pts) || pts < 0) {
        return res.status(400).json({ error: `Pontos inválidos para regra ${r.rule_name}` });
      }
      await db.query(
        'UPDATE scoring_rules SET base_points = $1, updated_at = NOW() WHERE rule_name = $2',
        [pts, r.rule_name]
      );
    }
    invalidateRuleCache();
    const updated = await getRulesList();
    res.json({ ok: true, rules: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar regras' });
  }
});

module.exports = router;
