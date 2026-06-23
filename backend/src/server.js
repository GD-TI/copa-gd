const path = require('path');

// .env na raiz do repo (website builder) ou em backend/
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Evita crash do processo por erros async não capturados
process.on('unhandledRejection', (reason) => {
  console.error('[Server] UnhandledRejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] UncaughtException (recuperando):', err.message);
});

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const scoreRoutes = require('./routes/scores');
const adminRoutes = require('./routes/admin');
const worldcupRoutes = require('./routes/worldcup');
const { syncMatchesFromApi } = require('./routes/worldcup');
const settingsRoutes = require('./routes/settings');
const { router: eventsRouter } = require('./routes/events');
const { startScheduler } = require('./services/scheduler');
const { seed } = require('./db/seed');
const { validateDatabaseUrl } = require('./config/validateDb');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
// Hostinger: use SERVE_STATIC=true ou NODE_ENV=production
const serveStatic = isProd || process.env.SERVE_STATIC === 'true';
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const fs = require('fs');
const distExists = fs.existsSync(frontendDist);

app.use(cors({
  origin: process.env.CORS_ORIGIN || (serveStatic ? false : '*'),
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Quando o frontend está em domínio diferente (split), reescreve photo_url relativas para absolutas
if (process.env.PUBLIC_BACKEND_URL) {
  const _backendBase = process.env.PUBLIC_BACKEND_URL.replace(/\/$/, '');
  function _rewritePhotoUrls(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(_rewritePhotoUrls);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'photo_url' && typeof v === 'string' && v.startsWith('/')) {
        out[k] = _backendBase + v;
      } else if (v && typeof v === 'object') {
        out[k] = _rewritePhotoUrls(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  app.use((req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = function(data) { return origJson(_rewritePhotoUrls(data)); };
    next();
  });
}

// Uploads de fotos dos grupos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/worldcup', worldcupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/events', eventsRouter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mode: serveStatic ? 'fullstack' : 'api',
    serveStatic,
    distExists,
    distPath: frontendDist,
    nodeEnv: process.env.NODE_ENV || 'unset',
  });
});

// Frontend estático (produção / website builder — uma única porta)
if (serveStatic && distExists) {
  app.use(express.static(frontendDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
} else if (serveStatic && !distExists) {
  console.warn(`[Server] SERVE_STATIC ativo mas pasta não existe: ${frontendDist}`);
  app.get('/', (req, res) => {
    res.status(503).json({
      error: 'Frontend não buildado',
      hint: 'Confirme que o build rodou: npm run build',
      distPath: frontendDist,
      health: '/api/health',
    });
  });
} else {
  app.get('/', (req, res) => {
    res.status(503).json({
      error: 'Modo API apenas',
      hint: 'No painel Hostinger: NODE_ENV=production e SERVE_STATIC=true',
      health: '/api/health',
    });
  });
}

// 404 API
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Rota não encontrada' });
  }
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, HOST, async () => {
  const mode = serveStatic && distExists ? 'API + frontend' : 'API';
  console.log(`🏆 Copa GD rodando em http://${HOST}:${PORT} (${mode})`);
  console.log(`[Server] NODE_ENV=${process.env.NODE_ENV || 'unset'} SERVE_STATIC=${process.env.SERVE_STATIC || 'unset'} dist=${distExists ? 'ok' : 'AUSENTE'}`);
  if (!distExists && serveStatic) console.warn(`[Server] dist esperado em: ${frontendDist}`);
  setTimeout(async () => {
    const dbCheck = validateDatabaseUrl();
    if (!dbCheck.ok) {
      console.error(`[Server] ⚠️  ${dbCheck.message}`);
      startScheduler();
      return;
    }
    try {
      await seed();
      startScheduler();
    } catch (e) {
      console.error('[Server] Erro no seed/scheduler:', e.message);
    }

    // Sincroniza jogos do Brasil na startup (silencioso — não recalcula pontos)
    const footballKey = process.env.FOOTBALL_API_KEY;
    if (footballKey) {
      syncMatchesFromApi(footballKey)
        .then(({ synced }) => console.log(`[Server] Jogos do Brasil sincronizados: ${synced}`))
        .catch(e => console.warn('[Server] Sync jogos (não crítico):', e.message));
    }
  }, 2000);
});
