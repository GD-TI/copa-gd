const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { findUserByUsername } = require('../services/externalApi');

const PLACEHOLDER_HASH = '$2a$10$PLACEHOLDER.NEVER.USED.FOR.LOGIN.xxxxxxxxxxxx';

// Upload de fotos de grupos (admin)
const uploadDir = path.join(__dirname, '../../uploads/groups');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `group_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

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

// POST /api/admin/users - criar usuário (jogador via login NewCorban)
router.post('/users', async (req, res) => {
  const { username, password, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url, group_id } = req.body;

  const userRole = role || 'player';
  if (!['player', 'admin'].includes(userRole)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  try {
    let corbanUser = null;
    let finalUsername = username?.trim().toLowerCase();
    let finalCorbanId = corban_id || null;
    let finalCorbanUsername = corban_username || null;
    let finalCorbanName = corban_name || null;
    let finalAvatar = corban_avatar_url || null;
    let finalDisplayName = display_name || null;
    let needsSetup = false;

    if (userRole === 'player') {
      const ncLogin = (corban_username || username || '').trim();
      if (!ncLogin) {
        return res.status(400).json({ error: 'Login NewCorban é obrigatório para jogadores' });
      }

      corbanUser = await findUserByUsername(ncLogin);
      if (!corbanUser) {
        return res.status(404).json({ error: `Usuário "${ncLogin}" não encontrado no NewCorban` });
      }
      if (!corbanUser.active) {
        return res.status(400).json({ error: 'Usuário inativo no NewCorban' });
      }

      finalUsername = corbanUser.username.trim().toLowerCase();
      finalCorbanId = String(corbanUser.id);
      finalCorbanUsername = corbanUser.username;
      finalCorbanName = corbanUser.name;
      finalAvatar = corbanUser.avatar_url || null;
      finalDisplayName = finalDisplayName || corbanUser.name;
      needsSetup = !password;

      const { rows: taken } = await db.query(
        'SELECT id FROM users WHERE corban_id = $1 AND active = true',
        [finalCorbanId]
      );
      if (taken.length > 0) {
        return res.status(400).json({ error: 'Este usuário NewCorban já está cadastrado' });
      }
    } else {
      if (!finalUsername || !password) {
        return res.status(400).json({ error: 'Usuário e senha são obrigatórios para admin' });
      }
    }

    const hash = password
      ? await bcrypt.hash(password, 10)
      : PLACEHOLDER_HASH;

    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url, needs_password_setup)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, username, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url, needs_password_setup`,
      [
        finalUsername,
        hash,
        userRole,
        finalDisplayName || finalUsername,
        finalCorbanId,
        finalCorbanUsername,
        finalCorbanName,
        finalAvatar,
        needsSetup,
      ]
    );

    const user = rows[0];

    if (group_id && userRole === 'player') {
      const { rows: gc } = await db.query(
        'SELECT COUNT(user_id) as count FROM group_memberships WHERE group_id = $1',
        [group_id]
      );
      if (parseInt(gc[0].count) >= 5) {
        return res.status(400).json({ error: 'Grupo está cheio (máx. 5)' });
      }
      await db.query(
        'INSERT INTO group_memberships (user_id, group_id, is_captain) VALUES ($1, $2, false)',
        [user.id, group_id]
      );
    }

    res.status(201).json(user);
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
             COUNT(DISTINCT gm.user_id) as member_count
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      WHERE g.active = true
      GROUP BY g.id
      ORDER BY g.name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
});

// POST /api/admin/groups - criar equipe
router.post('/groups', upload.single('photo'), async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nome da equipe deve ter pelo menos 2 caracteres' });
  }

  try {
    const photoUrl = req.file ? `/uploads/groups/${req.file.filename}` : null;
    const { rows } = await db.query(
      'INSERT INTO groups (name, photo_url, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), photoUrl, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar equipe' });
  }
});

// GET /api/admin/groups/:id/members
router.get('/groups/:id/members', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.corban_id, u.corban_username, u.corban_name,
              u.corban_avatar_url, u.needs_password_setup, gm.is_captain, gm.joined_at
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true
       ORDER BY gm.is_captain DESC, u.display_name`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar membros' });
  }
});

// POST /api/admin/groups/:id/members - adicionar jogador à equipe
router.post('/groups/:id/members', async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id é obrigatório' });
  }

  try {
    const { rows: groupRows } = await db.query(
      'SELECT id FROM groups WHERE id = $1 AND active = true', [id]
    );
    if (!groupRows.length) return res.status(404).json({ error: 'Equipe não encontrada' });

    const { rows: userRows } = await db.query(
      "SELECT id, role FROM users WHERE id = $1 AND active = true", [user_id]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Jogador não encontrado' });
    if (userRows[0].role !== 'player') {
      return res.status(400).json({ error: 'Apenas jogadores podem ser adicionados à equipe' });
    }

    const { rows: countRows } = await db.query(
      'SELECT COUNT(user_id) as count FROM group_memberships WHERE group_id = $1', [id]
    );
    if (parseInt(countRows[0].count) >= 5) {
      return res.status(400).json({ error: 'Equipe cheia (máximo 5 jogadores)' });
    }

    await db.query(
      `INSERT INTO group_memberships (user_id, group_id, is_captain)
       VALUES ($1, $2, false)
       ON CONFLICT (user_id) DO UPDATE SET group_id = $2, is_captain = false`,
      [user_id, id]
    );

    res.json({ message: 'Jogador adicionado à equipe' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// DELETE /api/admin/groups/:id/members/:userId - remover jogador da equipe
router.delete('/groups/:id/members/:userId', async (req, res) => {
  const { id, userId } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM group_memberships WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Membro não encontrado nesta equipe' });
    res.json({ message: 'Jogador removido da equipe' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// PUT /api/admin/groups/:id/goals - definir metas do grupo (legado — usar /settings/group-goals)
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

// GET /api/admin/groups/:id/points - listar ajustes de uma equipe
router.get('/groups/:id/points', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT pa.id, pa.points, pa.reason,
              pa.adjustment_date::text AS adjustment_date,
              pa.created_at,
              u.display_name AS admin_name
       FROM point_adjustments pa
       LEFT JOIN users u ON pa.admin_id = u.id
       WHERE pa.group_id = $1
       ORDER BY pa.created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar ajustes' });
  }
});

// POST /api/admin/groups/:id/points - ajuste manual de pontos
router.post('/groups/:id/points', async (req, res) => {
  const { id } = req.params;
  const { points, reason } = req.body;

  if (points === undefined || !reason?.trim()) {
    return res.status(400).json({ error: 'Pontos e justificativa são obrigatórios' });
  }

  const pts = parseFloat(points);
  if (isNaN(pts) || pts === 0) {
    return res.status(400).json({ error: 'Pontos deve ser um número diferente de zero' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO point_adjustments (group_id, admin_id, points, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, req.user.id, pts, reason.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao ajustar pontos' });
  }
});

// DELETE /api/admin/adjustments/:id - remover ajuste
router.delete('/adjustments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM point_adjustments WHERE id = $1', [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Ajuste não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover ajuste' });
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
