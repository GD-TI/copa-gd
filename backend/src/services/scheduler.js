const cron = require('node-cron');
const { calculateScores } = require('./scoring');
const { broadcast } = require('../routes/events');

function startScheduler() {
  cron.schedule('*/15 * * * *', async () => {
    console.log('[Scheduler] 🕐 Iniciando cálculo automático de pontuações...');
    try {
      await calculateScores(null);
      broadcast('scores_updated', { ts: Date.now() });
      console.log('[Scheduler] ✅ Cálculo concluído.');
    } catch (err) {
      console.error('[Scheduler] ❌ Erro no cálculo:', err.message);
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[Scheduler] ⏰ Agendador de pontuações iniciado (a cada 15 min).');
}

module.exports = { startScheduler };
