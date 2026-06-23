const cron = require('node-cron');
const { calculateScores } = require('./scoring');
const { broadcast } = require('../routes/events');

let isRunning = false;

function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) {
      console.log('[Scheduler] ⏭️  Cálculo anterior ainda em andamento, pulando rodada.');
      return;
    }
    isRunning = true;
    console.log('[Scheduler] 🕐 Iniciando cálculo automático de pontuações...');
    try {
      await calculateScores(null);
      broadcast('scores_updated', { ts: Date.now() });
      console.log('[Scheduler] ✅ Cálculo concluído.');
    } catch (err) {
      console.error('[Scheduler] ❌ Erro no cálculo:', err.message);
    } finally {
      isRunning = false;
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[Scheduler] ⏰ Agendador de pontuações iniciado (a cada 5 min).');
}

module.exports = { startScheduler };
