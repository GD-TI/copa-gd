// Rate limiter em memória para endpoints de autenticação
// Evita brute-force e requisições repetidas acidentais que sobrecarregam o servidor

const _attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // janela de 15 minutos
const MAX_ATTEMPTS = 20; // máx. tentativas por IP na janela

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = _attempts.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= MAX_ATTEMPTS) {
      return res.status(429).json({
        error: 'Muitas tentativas de login. Tente novamente em alguns minutos.',
      });
    }
    entry.count++;
  } else {
    _attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  }
  next();
}

// Limpa entradas expiradas a cada 30 min para não acumular memória
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _attempts.entries()) {
    if (now > entry.resetAt) _attempts.delete(ip);
  }
}, 30 * 60 * 1000).unref();

module.exports = { loginRateLimiter };
