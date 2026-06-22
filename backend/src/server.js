require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

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
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir uploads de fotos dos grupos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/worldcup', worldcupRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/events', eventsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Erro 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(PORT, async () => {
  console.log(`🏆 Copa GD Backend rodando na porta ${PORT}`);
  // Aguardar um momento para o banco estar pronto e executar seed
  setTimeout(async () => {
    await seed();
    startScheduler();
  }, 2000);
});
