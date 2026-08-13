const cron = require('node-cron');
const { calculateScores } = require('./scoring');
const { congelarPendentes } = require('./campaignFreezer');
const { congelarMesesPendentes } = require('./monthlyFreezer');
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

  // Congelamento do placar de campanha na virada do dia. 00:05 e não 00:00 para
  // não disputar a virada com o cron de pontuação.
  cron.schedule('5 0 * * *', async () => {
    console.log('[Scheduler] 🧊 Congelando placares de campanhas encerradas...');
    await congelarPendentes();
  }, {
    timezone: 'America/Sao_Paulo',
  });

  // Foto do ranking individual do mês que acabou. 00:20 do dia 1º: depois do
  // congelamento de campanhas (00:05), para as duas leituras da NewCorban não
  // caírem juntas na virada.
  cron.schedule('20 0 1 * *', async () => {
    console.log('[Scheduler] 🧊 Congelando ranking individual do mês encerrado...');
    await congelarMesesPendentes();
  }, {
    timezone: 'America/Sao_Paulo',
  });

  console.log('[Scheduler] ⏰ Agendador de pontuações iniciado (a cada 5 min).');
  console.log('[Scheduler] 🧊 Congelamento de campanhas agendado (00:05).');
  console.log('[Scheduler] 🧊 Congelamento do ranking mensal agendado (dia 1º, 00:20).');
}

module.exports = { startScheduler };
