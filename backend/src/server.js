const path = require('path');

// .env na raiz do repo (website builder) ou em backend/
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const scoreRoutes = require('./routes/scores');
const adminRoutes = require('./routes/admin');
const worldcupRoutes = require('./routes/worldcup');
const settingsRoutes = require('./routes/settings');
const { router: eventsRouter } = require('./routes/events');
const { startScheduler } = require('./services/scheduler');
const { seed } = require('./db/seed');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';
const serveStatic = isProd || process.env.SERVE_STATIC === 'true';
const frontendDist = path.join(__dirname, '../../frontend/dist');

app.use(cors({
  origin: process.env.CORS_ORIGIN || (serveStatic ? false : '*'),
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  });
});

// Frontend estático (produção / website builder — uma única porta)
if (serveStatic) {
  const fs = require('fs');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
        return next();
      }
      res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  } else {
    console.warn(`[Server] SERVE_STATIC ativo mas ${frontendDist} não existe. Rode: npm run build`);
  }
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
  console.log(`🏆 Copa GD rodando em http://${HOST}:${PORT} (${serveStatic ? 'API + frontend' : 'API'})`);
  setTimeout(async () => {
    try {
      await seed();
      startScheduler();
    } catch (e) {
      console.error('[Server] Erro no seed/scheduler:', e.message);
    }
  }, 2000);
});
