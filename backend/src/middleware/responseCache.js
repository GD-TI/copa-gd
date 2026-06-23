// Cache compartilhado de respostas para endpoints pesados (leaderboard, rankings, etc.)
// Quando múltiplos usuários fazem a mesma requisição simultânea, só a primeira bate no banco.
// As demais recebem a resposta cacheada até o TTL expirar.

const _cache = new Map();

function responseCache(ttlMs = 30_000) {
  return (req, res, next) => {
    const key = req.path;
    const hit = _cache.get(key);

    // Captura o res.json ANTES de wrappear (pode já estar wrappeado por rewritePhotoUrls)
    const origJson = res.json.bind(res);

    if (hit && Date.now() < hit.expiresAt) {
      res.setHeader('X-Cache', 'HIT');
      return origJson(hit.data);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json = function(data) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
      }
      return origJson(data);
    };
    next();
  };
}

// Chamado após recálculo de pontos — garante que o próximo request busca dados frescos
function invalidateResponseCache() {
  _cache.clear();
}

module.exports = { responseCache, invalidateResponseCache };
