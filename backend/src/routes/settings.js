const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

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

// PUT /api/settings/group-goals — admin only
// Body: { goals: [{ group_id, daily_goal_value, weekly_goal_value }] }
router.put('/group-goals', authMiddleware, adminOnly, async (req, res) => {
  const { goals } = req.body;

  if (!Array.isArray(goals) || goals.length === 0) {
    return res.status(400).json({ error: 'Lista de metas obrigatória' });
  }

  try {
    for (const g of goals) {
      const daily  = parseFloat(g.daily_goal_value  || 0) || 0;
      const weekly = parseFloat(g.weekly_goal_value || 0) || 0;
      await db.query(
        'UPDATE groups SET daily_goal_value = $1, weekly_goal_value = $2, updated_at = NOW() WHERE id = $3',
        [daily, weekly, g.group_id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar metas' });
  }
});

module.exports = router;
