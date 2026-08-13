const jwt = require('jsonwebtoken');
const { getManagedGroupIds } = require('../services/adminScopes');
const { resolverEscopoDeFranquia } = require('../services/franquiaScopes');

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

/** Dono de franquia — administra as campanhas da própria unidade */
function isFranqueado(user) {
  return user?.role === 'franqueado';
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

/** Quem pode criar campanha: a matriz e os donos de franquia */
function campaignAdminOnly(req, res, next) {
  if (!isMasterAdmin(req.user) && !isFranqueado(req.user)) {
    return res.status(403).json({ error: 'Acesso restrito à matriz e aos donos de franquia' });
  }
  next();
}

/**
 * Carrega `req.franquiaIds`: null para a matriz (todas), lista para os demais.
 * Toda rota de campanha passa por aqui — inclusive as de leitura, porque a
 * visibilidade da lista depende do escopo.
 */
async function attachFranquiaScopes(req, res, next) {
  try {
    req.franquiaIds = await resolverEscopoDeFranquia(req.user);
    next();
  } catch (err) {
    console.error('[Auth] escopo de franquia:', err.message);
    res.status(500).json({ error: 'Erro ao carregar permissões de franquia' });
  }
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
  campaignAdminOnly,
  attachManagedGroups,
  attachFranquiaScopes,
  requireGroupAccess,
  canAccessGroup,
  isMasterAdmin,
  isTeamAdmin,
  isConfigAdmin,
  isFranqueado,
};
