const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

router.use(authMiddleware, adminOnly);

// ===== USUÁRIOS =====

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.role, u.display_name,
             u.corban_id, u.corban_username, u.corban_name, u.corban_avatar_url,
             u.active, u.created_at,
             g.id as group_id, g.name as group_name, gm.is_captain
      FROM users u
      LEFT JOIN group_memberships gm ON u.id = gm.user_id
      LEFT JOIN groups g ON gm.group_id = g.id
      ORDER BY u.role, u.display_name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// POST /api/admin/users - criar usuário
router.post('/users', async (req, res) => {
  const { username, password, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Usuário, senha e papel são obrigatórios' });
  }

  if (!['player', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url`,
      [
        username.trim().toLowerCase(),
        hash,
        role,
        display_name || username,
        corban_id || null,
        corban_username || null,
        corban_name || null,
        corban_avatar_url || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome de usuário já existe' });
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// PUT /api/admin/users/:id - editar usuário
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, display_name, corban_id, corban_username, corban_name, corban_avatar_url, active } = req.body;

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (username) { updates.push(`username = $${idx++}`); values.push(username.trim().toLowerCase()); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }
    if (display_name !== undefined) { updates.push(`display_name = $${idx++}`); values.push(display_name); }
    if (corban_id !== undefined) { updates.push(`corban_id = $${idx++}`); values.push(corban_id || null); }
    if (corban_username !== undefined) { updates.push(`corban_username = $${idx++}`); values.push(corban_username || null); }
    if (corban_name !== undefined) { updates.push(`corban_name = $${idx++}`); values.push(corban_name || null); }
    if (corban_avatar_url !== undefined) { updates.push(`corban_avatar_url = $${idx++}`); values.push(corban_avatar_url || null); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(active); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    values.push(id);
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}
       RETURNING id, username, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url, active`,
      values
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// POST /api/admin/users/:id/deactivate - tirar da competição
router.post('/users/:id/deactivate', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE users SET active = false WHERE id = $1', [id]);
    // Remover do grupo
    await db.query('DELETE FROM group_memberships WHERE user_id = $1', [id]);
    res.json({ message: 'Jogador removido da competição' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao desativar jogador' });
  }
});

// POST /api/admin/users/:id/move-group - mover jogador para outro grupo
router.post('/users/:id/move-group', async (req, res) => {
  const { id } = req.params;
  const { group_id } = req.body;

  try {
    if (!group_id) {
      // Remover do grupo atual
      await db.query('DELETE FROM group_memberships WHERE user_id = $1', [id]);
      return res.json({ message: 'Jogador removido do grupo' });
    }

    // Verificar vagas no grupo destino
    const { rows: groupCheck } = await db.query(
      `SELECT COUNT(user_id) as count FROM group_memberships WHERE group_id = $1`,
      [group_id]
    );
    if (parseInt(groupCheck[0].count) >= 5) {
      return res.status(400).json({ error: 'Grupo de destino está cheio' });
    }

    // Upsert na membership
    await db.query(
      `INSERT INTO group_memberships (user_id, group_id, is_captain)
       VALUES ($1, $2, false)
       ON CONFLICT (user_id) DO UPDATE SET group_id = $2, is_captain = false`,
      [id, group_id]
    );
    res.json({ message: 'Jogador movido com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao mover jogador' });
  }
});

// ===== GRUPOS =====

// GET /api/admin/groups
router.get('/groups', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT g.*,
             COUNT(DISTINCT gm.user_id) as member_count,
             gg.daily_goal, gg.weekly_goal
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT daily_goal, weekly_goal FROM group_goals
        WHERE group_id = g.id AND valid_from <= CURRENT_DATE AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
        ORDER BY created_at DESC LIMIT 1
      ) gg ON true
      WHERE g.active = true
      GROUP BY g.id, gg.daily_goal, gg.weekly_goal
      ORDER BY g.name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
});

// PUT /api/admin/groups/:id/goals - definir metas do grupo
router.put('/groups/:id/goals', async (req, res) => {
  const { id } = req.params;
  const { daily_goal, weekly_goal, valid_from, valid_until } = req.body;

  try {
    const { rows } = await db.query(
      `INSERT INTO group_goals (group_id, daily_goal, weekly_goal, set_by, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, daily_goal || 0, weekly_goal || 0, req.user.id, valid_from || new Date().toISOString().split('T')[0], valid_until || null]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao definir metas' });
  }
});

// POST /api/admin/groups/:id/points - ajuste manual de pontos
router.post('/groups/:id/points', async (req, res) => {
  const { id } = req.params;
  const { points, reason } = req.body;

  if (points === undefined || !reason) {
    return res.status(400).json({ error: 'Pontos e motivo são obrigatórios' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO point_adjustments (group_id, admin_id, points, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, req.user.id, parseFloat(points), reason]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao ajustar pontos' });
  }
});

// DELETE /api/admin/groups/:id - desativar grupo
router.delete('/groups/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('UPDATE groups SET active = false WHERE id = $1', [id]);
    res.json({ message: 'Grupo desativado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao desativar grupo' });
  }
});

// ===== USUÁRIOS NEWCORBAN =====

// GET /api/admin/newcorban-users - listar usuários do NewCorban (paginado)
router.get('/newcorban-users', async (req, res) => {
  const externalApi = require('../services/externalApi');
  const { page = 1, per_page = 50 } = req.query;
  try {
    const data = await externalApi.getUsersPage(parseInt(page), parseInt(per_page));
    // Filtrar bots e escondidos, retornar apenas campos relevantes
    const users = (data.data || [])
      .filter(u => !u.is_bot && !u.is_hidden && u.active)
      .map(u => ({
        id: String(u.id),
        name: u.name,
        username: u.username,
        team_name: u.team_name,
        franchise_name: u.franchise_name,
        role_name: u.role_name,
        avatar_url: u.avatar_url,
      }));
    res.json({ users, meta: data.meta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Erro ao buscar usuários NewCorban: ${err.message}` });
  }
});

// GET /api/admin/newcorban-users/lookup?username=xxx
// Busca um usuário específico pelo username no NewCorban
router.get('/newcorban-users/lookup', async (req, res) => {
  const externalApi = require('../services/externalApi');
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: 'Parâmetro username é obrigatório' });
  }

  try {
    const user = await externalApi.findUserByUsername(username.trim());
    if (!user) {
      return res.status(404).json({ error: `Usuário "${username}" não encontrado no NewCorban` });
    }
    res.json({
      id: String(user.id),
      name: user.name,
      username: user.username,
      team_name: user.team_name,
      franchise_name: user.franchise_name,
      role_name: user.role_name,
      avatar_url: user.avatar_url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Erro na busca: ${err.message}` });
  }
});

module.exports = router;
