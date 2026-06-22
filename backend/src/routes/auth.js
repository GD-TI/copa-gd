const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { findUserByUsername } = require('../services/externalApi');

async function buildUserResponse(user) {
  let groupInfo = null;
  if (user.role === 'player') {
    const { rows: groupRows } = await db.query(
      `SELECT g.id, g.name, g.photo_url, gm.is_captain
       FROM group_memberships gm
       JOIN groups g ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND g.active = true`,
      [user.id]
    );
    if (groupRows.length > 0) groupInfo = groupRows[0];
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name || user.username,
    corban_id: user.corban_id,
    corban_name: user.corban_name,
    corban_username: user.corban_username,
    group: groupInfo,
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name || user.username,
    },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// POST /api/auth/login — login pelo username NewCorban (ex: alessandro.ti)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    const login = username.trim().toLowerCase();
    const { rows } = await db.query(
      'SELECT * FROM users WHERE (username = $1 OR corban_username = $1) AND active = true',
      [login]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não cadastrado. Solicite ao administrador.' });
    }

    const user = rows[0];

    if (user.needs_password_setup) {
      return res.status(403).json({
        error: 'Primeiro acesso: defina sua senha',
        needs_password_setup: true,
        username: user.username,
        display_name: user.display_name || user.corban_name || user.username,
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const token = signToken(user);
    res.json({ token, user: await buildUserResponse(user) });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// POST /api/auth/setup-password — primeiro acesso após cadastro pelo admin
router.post('/setup-password', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }

  try {
    const login = username.trim().toLowerCase();
    const { rows } = await db.query(
      'SELECT * FROM users WHERE (username = $1 OR corban_username = $1) AND active = true',
      [login]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado. Solicite ao administrador.' });
    }

    const user = rows[0];
    if (!user.needs_password_setup) {
      return res.status(400).json({ error: 'Senha já definida. Use o login normal.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      `UPDATE users SET password_hash = $1, needs_password_setup = false, updated_at = NOW() WHERE id = $2`,
      [hash, user.id]
    );

    const token = signToken(user);
    res.json({ token, user: await buildUserResponse({ ...user, needs_password_setup: false }) });
  } catch (err) {
    console.error('Erro no setup-password:', err);
    res.status(500).json({ error: 'Erro ao definir senha' });
  }
});

// GET /api/auth/check-user?username=xxx — verifica se usuário existe e precisa definir senha
router.get('/check-user', async (req, res) => {
  const { username } = req.query;
  if (!username?.trim()) {
    return res.status(400).json({ error: 'username é obrigatório' });
  }

  try {
    const login = username.trim().toLowerCase();
    const { rows } = await db.query(
      'SELECT id, username, display_name, corban_name, needs_password_setup, role FROM users WHERE (username = $1 OR corban_username = $1) AND active = true',
      [login]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não cadastrado. Solicite ao administrador.' });
    }

    const user = rows[0];
    res.json({
      username: user.username,
      display_name: user.display_name || user.corban_name || user.username,
      needs_password_setup: user.needs_password_setup,
      role: user.role,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao verificar usuário' });
  }
});

// GET /api/auth/lookup-corban?username=xxx (público — usado pelo admin)
router.get('/lookup-corban', async (req, res) => {
  const { username } = req.query;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'username é obrigatório' });
  }

  try {
    const corbanUser = await findUserByUsername(username.trim());

    if (!corbanUser) {
      return res.status(404).json({ error: `Usuário "${username}" não encontrado no NewCorban` });
    }

    if (!corbanUser.active) {
      return res.status(400).json({ error: 'Este usuário está inativo no NewCorban' });
    }

    res.json({
      id: corbanUser.id,
      name: corbanUser.name,
      username: corbanUser.username,
      team_name: corbanUser.team_name || null,
      avatar_url: corbanUser.avatar_url || null,
    });
  } catch (err) {
    console.error('Erro no lookup NewCorban:', err);
    res.status(503).json({ error: 'Não foi possível consultar o NewCorban' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, role, display_name, corban_id, corban_name, corban_username FROM users WHERE id = $1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(await buildUserResponse(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

module.exports = router;
