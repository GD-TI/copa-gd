const jwt = require('jsonwebtoken');
const { getManagedGroupIds } = require('../services/adminScopes');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function isMasterAdmin(user) {
  return user?.role === 'admin';
}

function isTeamAdmin(user) {
  return user?.role === 'team_admin';
}

function isConfigAdmin(user) {
  return isMasterAdmin(user) || isTeamAdmin(user);
}

/** Admin master — acesso total */
function adminOnly(req, res, next) {
  if (!isMasterAdmin(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito ao administrador master' });
  }
  next();
}

/** Admin master ou sub-admin de equipes */
function configAdminOnly(req, res, next) {
  if (!isConfigAdmin(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

async function attachManagedGroups(req, res, next) {
  try {
    if (isTeamAdmin(req.user)) {
      req.managedGroupIds = await getManagedGroupIds(req.user.id);
    } else if (isMasterAdmin(req.user)) {
      req.managedGroupIds = null;
    } else {
      req.managedGroupIds = [];
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao carregar permissões' });
  }
}

function canAccessGroup(req, groupId) {
  if (isMasterAdmin(req.user)) return true;
  const gid = parseInt(groupId, 10);
  return req.managedGroupIds?.includes(gid) ?? false;
}

function requireGroupAccess(req, res, next) {
  const gid = parseInt(req.params.id, 10);
  if (!canAccessGroup(req, gid)) {
    return res.status(403).json({ error: 'Sem permissão para esta equipe' });
  }
  next();
}

module.exports = {
  authMiddleware,
  adminOnly,
  configAdminOnly,
  attachManagedGroups,
  requireGroupAccess,
  canAccessGroup,
  isMasterAdmin,
  isTeamAdmin,
  isConfigAdmin,
};
