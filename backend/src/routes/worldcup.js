const router = require('express').Router();
const axios = require('axios');
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { calculateScores } = require('../services/scoring');
const { broadcast } = require('./events');

function triggerBrazilMatchRecalc(adminId) {
  console.log('[WorldCup] Disparando recálculo (jogos do Brasil alterados)...');
  calculateScores(adminId)
    .then(() => broadcast('scores_updated', { ts: Date.now() }))
    .catch(e => console.error('[WorldCup] Erro no recálculo:', e.message));
}

// GET /api/worldcup/matches - listar jogos do Brasil
router.get('/matches', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM brazil_matches ORDER BY match_date ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar jogos' });
  }
});

// GET /api/worldcup/next - próximo jogo do Brasil
router.get('/next', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM brazil_matches
       WHERE match_date >= CURRENT_DATE AND double_points = true
       ORDER BY match_date ASC LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar próximo jogo' });
  }
});

// GET /api/worldcup/today - jogo do Brasil hoje
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM brazil_matches WHERE match_date = CURRENT_DATE AND double_points = true'
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao verificar jogo de hoje' });
  }
});

// POST /api/worldcup/matches - adicionar jogo (admin)
router.post('/matches', authMiddleware, adminOnly, async (req, res) => {
  const { match_date, opponent, stage, description, double_points } = req.body;

  if (!match_date) {
    return res.status(400).json({ error: 'Data do jogo é obrigatória' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO brazil_matches (match_date, opponent, stage, description, double_points)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (match_date) DO UPDATE
         SET opponent = EXCLUDED.opponent,
             stage = EXCLUDED.stage,
             description = EXCLUDED.description,
             double_points = EXCLUDED.double_points
       RETURNING *`,
      [match_date, opponent || null, stage || null, description || null, double_points !== false]
    );
    triggerBrazilMatchRecalc(req.user.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar jogo' });
  }
});

// DELETE /api/worldcup/matches/:id - remover jogo (admin)
router.delete('/matches/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM brazil_matches WHERE id = $1', [req.params.id]);
    triggerBrazilMatchRecalc(req.user.id);
    res.json({ message: 'Jogo removido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover jogo' });
  }
});

// PATCH /api/worldcup/matches/:id - ativar/desativar pontos dobrados (admin)
router.patch('/matches/:id', authMiddleware, adminOnly, async (req, res) => {
  const { double_points } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE brazil_matches SET double_points = $1 WHERE id = $2 RETURNING *',
      [double_points, req.params.id]
    );
    triggerBrazilMatchRecalc(req.user.id);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar jogo' });
  }
});

// POST /api/worldcup/sync - sincronizar via API de futebol (admin)
router.post('/sync', authMiddleware, adminOnly, async (req, res) => {
  const apiKey = process.env.FOOTBALL_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      error: 'FOOTBALL_API_KEY não configurada. Configure no arquivo .env para usar sincronização automática.',
    });
  }

  try {
    // Brazil team ID na football-data.org = 764
    const response = await axios.get(
      'https://api.football-data.org/v4/teams/764/matches',
      {
        params: { season: 2026, competitions: 'WC' },
        headers: { 'X-Auth-Token': apiKey },
        timeout: 10000,
      }
    );

    const matches = response.data.matches || [];
    let synced = 0;

    for (const match of matches) {
      const matchDate = match.utcDate.split('T')[0];
      const isHome = match.homeTeam.id === 764;
      const opponent = isHome ? match.awayTeam.name : match.homeTeam.name;

      const stageMap = {
        'GROUP_STAGE': 'group',
        'LAST_16': 'round_of_16',
        'QUARTER_FINALS': 'quarter',
        'SEMI_FINALS': 'semi',
        'FINAL': 'final',
        'THIRD_PLACE': 'third_place',
      };

      await db.query(
        `INSERT INTO brazil_matches (match_date, opponent, stage, description, double_points)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (match_date) DO UPDATE
           SET opponent = EXCLUDED.opponent,
               stage = EXCLUDED.stage,
               description = EXCLUDED.description`,
        [
          matchDate,
          opponent,
          stageMap[match.stage] || match.stage,
          `Brasil x ${opponent} - ${match.stage}`,
        ]
      );
      synced++;
    }

    triggerBrazilMatchRecalc(req.user.id);
    res.json({ message: `${synced} jogos sincronizados`, count: synced });
  } catch (err) {
    console.error('Erro sync Copa:', err.message);
    res.status(500).json({ error: `Erro ao sincronizar: ${err.message}` });
  }
});

module.exports = router;
