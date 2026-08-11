// Cache compartilhado de respostas para endpoints pesados (leaderboard, rankings, etc.)
// Quando múltiplos usuários fazem a mesma requisição simultânea, só a primeira bate no banco.
// As demais recebem a resposta cacheada até o TTL expirar.

const _cache = new Map();

// Retorna true quando o dado não tem utilidade para cachear (array vazio ou objeto com todos arrays vazios)
function isEmptyResult(data) {
  if (Array.isArray(data)) return data.length === 0;
  if (data && typeof data === 'object') {
    const vals = Object.values(data);
    return vals.length > 0 && vals.every(v => Array.isArray(v) && v.length === 0);
  }
  return false;
}

function responseCache(ttlMs = 30_000) {
  return (req, res, next) => {
    // originalUrl, não req.path: o placar aceita ?date= e duas datas diferentes
    // compartilhariam a mesma entrada, servindo o dia errado.
    const key = req.originalUrl || req.url;
    const hit = _cache.get(key);

    // Captura o res.json ANTES de wrappear (pode já estar wrappeado por rewritePhotoUrls)
    const origJson = res.json.bind(res);

    if (hit && Date.now() < hit.expiresAt) {
      res.setHeader('X-Cache', 'HIT');
      return origJson(hit.data);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json = function(data) {
      if (res.statusCode >= 200 && res.statusCode < 300 && !isEmptyResult(data)) {
        // A rota pode pedir um TTL diferente depois de saber o que respondeu —
        // dia encerrado não muda mais e aguenta ficar quente por mais tempo.
        const ttl = Number(res.locals?.cacheTtlMs) > 0 ? Number(res.locals.cacheTtlMs) : ttlMs;
        _cache.set(key, { data, expiresAt: Date.now() + ttl });
      }
      return origJson(data);
    };
    next();
  };
}

/**
 * Invalida o cache. Sem argumento limpa tudo; com prefixos, só as chaves que
 * começam com eles.
 *
 * O cron dispara `scores_updated` a cada 5 min e limpar o mapa inteiro derrubava
 * junto o placar de campanha, que não lê `score_events` — o placar voltava ao
 * caminho frio (duas chamadas à NewCorban) a cada rodada, justo quando o SSE
 * mandava todos os telões recarregarem ao mesmo tempo.
 */
function invalidateResponseCache(prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : prefixes ? [prefixes] : null;
  if (!list || list.length === 0) {
    _cache.clear();
    return;
  }
  for (const key of [..._cache.keys()]) {
    if (list.some(p => key.startsWith(p))) _cache.delete(key);
  }
}

module.exports = { responseCache, invalidateResponseCache };
