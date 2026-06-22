const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { findUserByUsername } = require('../services/externalApi');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE username = $1 AND active = true',
      [username.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name || user.username,
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Buscar grupo do jogador
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

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name || user.username,
        corban_id: user.corban_id,
        corban_name: user.corban_name,
        group: groupInfo,
      },
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro ao realizar login' });
  }
});

// POST /api/auth/register - auto-cadastro do jogador
router.post('/register', async (req, res) => {
  const { username, password, newcorban_username } = req.body;

  if (!username || !password || !newcorban_username) {
    return res.status(400).json({ error: 'Usuário, senha e username NewCorban são obrigatórios' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  }

  try {
    // 1. Verificar se username já existe no app
    const { rows: existing } = await db.query(
      'SELECT id FROM users WHERE username = $1',
      [username.trim().toLowerCase()]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Este nome de usuário já está em uso' });
    }

    // 2. Buscar usuário no NewCorban pelo username
    let corbanUser;
    try {
      corbanUser = await findUserByUsername(newcorban_username.trim());
    } catch (apiErr) {
      return res.status(503).json({ error: `Não foi possível consultar o NewCorban: ${apiErr.message}` });
    }

    if (!corbanUser) {
      return res.status(404).json({ error: `Usuário "${newcorban_username}" não encontrado no NewCorban. Verifique o username.` });
    }

    if (!corbanUser.active) {
      return res.status(400).json({ error: 'Este usuário está inativo no NewCorban' });
    }

    // 3. Verificar se esse corban_id já está vinculado a outra conta
    const { rows: corbanTaken } = await db.query(
      'SELECT id, username FROM users WHERE corban_id = $1 AND active = true',
      [String(corbanUser.id)]
    );
    if (corbanTaken.length > 0) {
      return res.status(400).json({ error: `Este usuário NewCorban já está vinculado à conta "${corbanTaken[0].username}"` });
    }

    // 4. Criar conta
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url)
       VALUES ($1, $2, 'player', $3, $4, $5, $6, $7)
       RETURNING id, username, role, display_name, corban_id, corban_username, corban_name, corban_avatar_url`,
      [
        username.trim().toLowerCase(),
        hash,
        corbanUser.name,
        String(corbanUser.id),
        corbanUser.username,
        corbanUser.name,
        corbanUser.avatar_url || null,
      ]
    );

    const user = rows[0];

    // 5. Gerar token e retornar (auto-login)
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: { ...user, group: null },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Este nome de usuário já está em uso' });
    }
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// GET /api/auth/lookup-corban?username=xxx  (público — sem auth)
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
      'SELECT id, username, role, display_name, corban_id, corban_name FROM users WHERE id = $1',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = rows[0];

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

    res.json({ ...user, group: groupInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

module.exports = router;
