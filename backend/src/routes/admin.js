const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authMiddleware, adminOnly, configAdminOnly, attachManagedGroups, requireGroupAccess, canAccessGroup, isMasterAdmin } = require('../middleware/auth');
const { setManagedGroups, getManagedGroupIds } = require('../services/adminScopes');
const { migrateTeamAdminSupport } = require('../db/migrations');
const { findUserByUsername } = require('../services/externalApi');
const { calculateScores } = require('../services/scoring');
const { broadcast } = require('./events');
const {
  uploadPhoto,
  GROUP_PUBLIC_COLUMNS,
  saveGroupPhoto,
  photoSaveError,
} = require('../services/groupPhotoStorage');

const PLACEHOLDER_HASH = '$2a$10$PLACEHOLDER.NEVER.USED.FOR.LOGIN.xxxxxxxxxxxx';

function triggerRecalculate(adminId) {
  console.log('[Admin] Disparando recálculo completo da campanha (mudança de equipe)...');
  calculateScores(adminId)
    .then(() => broadcast('scores_updated', { ts: Date.now() }))
    .catch(e => console.error('[Admin] Erro no recálculo pós-membership:', e.message));
}

router.use(authMiddleware, configAdminOnly, attachManagedGroups);

// ===== SUB-ADMINS (master only) =====

router.get('/team-admins', adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.display_name, u.active, u.created_at,
             COALESCE(
               json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
               FILTER (WHERE g.id IS NOT NULL),
               '[]'
             ) AS groups
      FROM users u
      LEFT JOIN admin_team_scopes ats ON u.id = ats.user_id
      LEFT JOIN groups g ON ats.group_id = g.id AND g.active = true
      WHERE u.role = 'team_admin'
      GROUP BY u.id
      ORDER BY u.display_name
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar sub-admins' });
  }
});

router.post('/team-admins', adminOnly, async (req, res) => {
  const { username, password, display_name, group_ids } = req.body;

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }
  if (!Array.isArray(group_ids) || group_ids.length === 0) {
    return res.status(400).json({ error: 'Selecione ao menos uma equipe' });
  }

  try {
    await migrateTeamAdminSupport();
    const hash = await bcrypt.hash(password, 10);
    const login = username.trim().toLowerCase();
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, role, display_name, needs_password_setup)
       VALUES ($1, $2, 'team_admin', $3, false)
       RETURNING id, username, role, display_name, active, created_at`,
      [login, hash, display_name?.trim() || login]
    );
    const user = rows[0];
    const scopes = await setManagedGroups(user.id, group_ids);
    res.status(201).json({ ...user, group_ids: scopes });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome de usuário já existe' });
    if (err.code === '23514') {
      return res.status(503).json({
        error: 'Banco não migrado para sub-admins. Execute no PostgreSQL: ALTER TABLE users DROP CONSTRAINT users_role_check; ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (\'player\', \'admin\', \'team_admin\'));',
      });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar sub-admin' });
  }
});

router.put('/team-admins/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { username, password, display_name, active, group_ids } = req.body;

  try {
    const { rows: existing } = await db.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'team_admin'",
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Sub-admin não encontrado' });

    const updates = [];
    const values = [];
    let idx = 1;

    if (username) { updates.push(`username = $${idx++}`); values.push(username.trim().toLowerCase()); }
    if (password) {
      updates.push(`password_hash = $${idx++}`);
      values.push(await bcrypt.hash(password, 10));
    }
    if (display_name !== undefined) { updates.push(`display_name = $${idx++}`); values.push(display_name); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(active); }

    if (updates.length > 0) {
      values.push(id);
      await db.query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
        values
      );
    }

    if (Array.isArray(group_ids)) {
      if (group_ids.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos uma equipe' });
      }
      await setManagedGroups(id, group_ids);
    }

    const scopes = await getManagedGroupIds(id);
    const { rows } = await db.query(
      'SELECT id, username, role, display_name, active, created_at FROM users WHERE id = $1',
      [id]
    );
    res.json({ ...rows[0], group_ids: scopes });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome de usuário já existe' });
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar sub-admin' });
  }
});

// ===== USUÁRIOS =====

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    let query = `
      SELECT u.id, u.username, u.role, u.display_name,
             u.corban_id, u.corban_username, u.corban_name, u.corban_avatar_url,
             u.active, u.created_at,
             g.id as group_id, g.name as group_name, gm.is_captain
      FROM users u
      LEFT JOIN group_memberships gm ON u.id = gm.user_id
      LEFT JOIN groups g ON gm.group_id = g.id
    `;
    const params = [];

    if (!isMasterAdmin(req.user)) {
      const scopes = req.managedGroupIds || [];
      if (scopes.length === 0) return res.json([]);
      query += ` WHERE u.role = 'player' AND g.id = ANY($1::int[])`;
      params.push(scopes);
    }

    query += ' ORDER BY u.role, u.display_name';

    const { rows } = await db.query(query, params);
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
  if (!['player', 'admin', 'team_admin'].includes(userRole)) {
    return res.status(400).json({ error: 'Papel inválido' });
  }

  if ((userRole === 'admin' || userRole === 'team_admin') && !isMasterAdmin(req.user)) {
    return res.status(403).json({ error: 'Apenas o admin master pode criar administradores' });
  }

  if (userRole === 'team_admin') {
    const { group_ids } = req.body;
    if (!Array.isArray(group_ids) || group_ids.length === 0) {
      return res.status(400).json({ error: 'Sub-admin precisa de ao menos uma equipe' });
    }
  }

  if (userRole === 'player' && group_id && !isMasterAdmin(req.user)) {
    if (!canAccessGroup(req, group_id)) {
      return res.status(403).json({ error: 'Sem permissão para esta equipe' });
    }
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

    if (userRole === 'team_admin') {
      await setManagedGroups(user.id, req.body.group_ids);
    }

    if (group_id && userRole === 'player') {
      const { rows: gc } = await db.query(
        `SELECT COUNT(gm.user_id) as count FROM group_memberships gm
         JOIN users u ON gm.user_id = u.id WHERE gm.group_id = $1 AND u.active = true`,
        [group_id]
      );
      if ((parseInt(gc[0].count) || 0) >= 6) {
        return res.status(400).json({ error: 'Grupo está cheio (máx. 6)' });
      }
      await db.query(
        'INSERT INTO group_memberships (user_id, group_id, is_captain) VALUES ($1, $2, false)',
        [user.id, group_id]
      );
      triggerRecalculate(req.user.id);
    }

    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Nome de usuário já existe' });
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// PUT /api/admin/users/:id - editar usuário (master ou jogador em equipe gerenciada)
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, display_name, corban_id, corban_username, corban_name, corban_avatar_url, active } = req.body;

  try {
    if (!isMasterAdmin(req.user)) {
      const { rows: target } = await db.query(
        `SELECT u.role, gm.group_id FROM users u
         LEFT JOIN group_memberships gm ON u.id = gm.user_id
         WHERE u.id = $1`,
        [id]
      );
      if (!target.length || target[0].role !== 'player') {
        return res.status(403).json({ error: 'Sem permissão para editar este usuário' });
      }
      if (!target[0].group_id || !canAccessGroup(req, target[0].group_id)) {
        return res.status(403).json({ error: 'Sem permissão para editar este usuário' });
      }
    }
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

// POST /api/admin/users/:id/deactivate
router.post('/users/:id/deactivate', async (req, res) => {
  const { id } = req.params;
  try {
    if (!isMasterAdmin(req.user)) {
      const { rows: target } = await db.query(
        `SELECT u.role, gm.group_id FROM users u
         LEFT JOIN group_memberships gm ON u.id = gm.user_id WHERE u.id = $1`,
        [id]
      );
      if (!target.length || target[0].role !== 'player' || !canAccessGroup(req, target[0].group_id)) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
    }
    await db.query('UPDATE users SET active = false WHERE id = $1', [id]);
    await db.query('DELETE FROM group_memberships WHERE user_id = $1', [id]);
    res.json({ message: 'Jogador removido da competição' });
    triggerRecalculate(req.user.id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao desativar jogador' });
  }
});

// POST /api/admin/users/:id/move-group
router.post('/users/:id/move-group', async (req, res) => {
  const { id } = req.params;
  const { group_id } = req.body;

  try {
    if (!isMasterAdmin(req.user)) {
      const { rows: target } = await db.query(
        `SELECT gm.group_id FROM group_memberships gm WHERE gm.user_id = $1`,
        [id]
      );
      const fromOk = !target.length || canAccessGroup(req, target[0].group_id);
      const toOk = !group_id || canAccessGroup(req, group_id);
      if (!fromOk || !toOk) {
        return res.status(403).json({ error: 'Sem permissão para mover entre estas equipes' });
      }
    }
    if (!group_id) {
      await db.query('DELETE FROM group_memberships WHERE user_id = $1', [id]);
      triggerRecalculate(req.user.id);
      return res.json({ message: 'Jogador removido do grupo' });
    }

    // Verificar vagas no grupo destino
    const { rows: groupCheck } = await db.query(
      `SELECT COUNT(gm.user_id) as count FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id WHERE gm.group_id = $1 AND u.active = true`,
      [group_id]
    );
    if ((parseInt(groupCheck[0].count) || 0) >= 6) {
      return res.status(400).json({ error: 'Grupo de destino está cheio (máx. 6)' });
    }

    // Upsert na membership
    await db.query(
      `INSERT INTO group_memberships (user_id, group_id, is_captain)
       VALUES ($1, $2, false)
       ON CONFLICT (user_id) DO UPDATE SET group_id = $2, is_captain = false`,
      [id, group_id]
    );
    triggerRecalculate(req.user.id);
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
    const params = [];
    let scopeFilter = '';
    if (!isMasterAdmin(req.user)) {
      const scopes = req.managedGroupIds || [];
      if (scopes.length === 0) return res.json([]);
      scopeFilter = ' AND g.id = ANY($1::int[])';
      params.push(scopes);
    }

    const { rows } = await db.query(`
      SELECT g.id, g.name, g.photo_url, g.created_by, g.active, g.created_at, g.updated_at,
             g.daily_goal_value, g.weekly_goal_value, g.goal_points,
             COUNT(DISTINCT gm.user_id) as member_count
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      WHERE g.active = true${scopeFilter}
      GROUP BY g.id
      ORDER BY g.name
    `, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
});

// POST /api/admin/groups - criar equipe (master)
router.post('/groups', adminOnly, uploadPhoto('photo'), async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nome da equipe deve ter pelo menos 2 caracteres' });
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
    res.status(500).json({ error: 'Erro ao criar equipe' });
  }
});

// PUT /api/admin/groups/:id/photo
router.put('/groups/:id/photo', requireGroupAccess, uploadPhoto('photo'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'Selecione uma imagem (campo photo)' });
  }
  try {
    const { rows: exists } = await db.query(
      'SELECT id FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (!exists.length) return res.status(404).json({ error: 'Equipe não encontrada' });

    await saveGroupPhoto(id, req.file.buffer, req.file.mimetype);
    const { rows } = await db.query(
      `SELECT ${GROUP_PUBLIC_COLUMNS} FROM groups WHERE id = $1`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '42703') return photoSaveError(err, res);
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar foto' });
  }
});

// DELETE /api/admin/groups/:id/photo
router.delete('/groups/:id/photo', requireGroupAccess, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(
      `UPDATE groups SET photo_data = NULL, photo_mime = NULL, photo_url = NULL, updated_at = NOW()
       WHERE id = $1 AND active = true
       RETURNING ${GROUP_PUBLIC_COLUMNS}`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Equipe não encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover foto' });
  }
});

// GET /api/admin/groups/:id/members
router.get('/groups/:id/members', requireGroupAccess, async (req, res) => {
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

// POST /api/admin/groups/:id/members
router.post('/groups/:id/members', requireGroupAccess, async (req, res) => {
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
      `SELECT COUNT(gm.user_id) as count FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id WHERE gm.group_id = $1 AND u.active = true`, [id]
    );
    if ((parseInt(countRows[0].count) || 0) >= 6) {
      return res.status(400).json({ error: 'Equipe cheia (máximo 6 jogadores)' });
    }

    await db.query(
      `INSERT INTO group_memberships (user_id, group_id, is_captain)
       VALUES ($1, $2, false)
       ON CONFLICT (user_id) DO UPDATE SET group_id = $2, is_captain = false`,
      [user_id, id]
    );

    res.json({ message: 'Jogador adicionado à equipe' });
    triggerRecalculate(req.user.id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// DELETE /api/admin/groups/:id/members/:userId
router.delete('/groups/:id/members/:userId', requireGroupAccess, async (req, res) => {
  const { id, userId } = req.params;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM group_memberships WHERE group_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Membro não encontrado nesta equipe' });
    res.json({ message: 'Jogador removido da equipe' });
    triggerRecalculate(req.user.id);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// PUT /api/admin/groups/:id/goals (legado)
router.put('/groups/:id/goals', requireGroupAccess, async (req, res) => {
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

// GET /api/admin/groups/:id/points
router.get('/groups/:id/points', requireGroupAccess, async (req, res) => {
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

// POST /api/admin/groups/:id/points
router.post('/groups/:id/points', requireGroupAccess, async (req, res) => {
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

// DELETE /api/admin/adjustments/:id
router.delete('/adjustments/:id', authMiddleware, configAdminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    if (!isMasterAdmin(req.user)) {
      const { rows } = await db.query(
        'SELECT group_id FROM point_adjustments WHERE id = $1',
        [id]
      );
      if (!rows.length || !canAccessGroup(req, rows[0].group_id)) {
        return res.status(403).json({ error: 'Sem permissão para remover este ajuste' });
      }
    }
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

// DELETE /api/admin/groups/:id - desativar grupo (master)
router.delete('/groups/:id', adminOnly, async (req, res) => {
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

// GET /api/admin/newcorban-users (master)
router.get('/newcorban-users', adminOnly, async (req, res) => {
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
