/**
 * Conferência das variáveis de ambiente na subida.
 *
 * O `.env` é gitignored e não tem backup: uma reescrita do arquivo derruba um
 * segredo em silêncio, e o app só reclama quando alguém abre a tela — foi assim
 * que a perda do NEWCORBAN_PROPOSALS_TOKEN virou "Placar indisponível" horas
 * depois, sem ninguém ligar uma coisa à outra. Este log fecha essa distância.
 */

const OBRIGATORIAS = [
  ['DATABASE_URL',        'sem banco o app não sobe'],
  ['JWT_SECRET',          'ninguém consegue logar'],
  ['NEWCORBAN_USERNAME',  'ranking e cadastro de consultores param'],
  ['NEWCORBAN_PASSWORD',  'ranking e cadastro de consultores param'],
];

// Ausência aqui degrada, não derruba — por isso o texto diz o que se perde.
const RECOMENDADAS = [
  ['NEWCORBAN_PROPOSALS_TOKEN', 'placar cai na API antiga (janela de ~30 dias, produtos 7/13)'],
  ['NEWCORBAN_API_USERNAME',    'sem ela E sem o token da v3, o placar fica sem fonte de propostas'],
  ['NEWCORBAN_API_PASSWORD',    'idem'],
  ['FOOTBALL_API_KEY',          'sem sync automático do calendário da Copa'],
];

function vazia(nome) {
  const v = process.env[nome];
  return v === undefined || String(v).trim() === '';
}

/** Loga o que falta. Não lança: quem decide abortar é o server.js. */
function validateEnv() {
  const faltandoObrigatorias = OBRIGATORIAS.filter(([n]) => vazia(n));
  const faltandoRecomendadas = RECOMENDADAS.filter(([n]) => vazia(n));

  for (const [nome, efeito] of faltandoObrigatorias) {
    console.error(`[Env] ❌ ${nome} ausente — ${efeito}`);
  }
  for (const [nome, efeito] of faltandoRecomendadas) {
    console.warn(`[Env] ⚠️  ${nome} ausente — ${efeito}`);
  }
  if (!faltandoObrigatorias.length && !faltandoRecomendadas.length) {
    console.log('[Env] ✅ todas as variáveis esperadas estão definidas');
  }

  return {
    ok: faltandoObrigatorias.length === 0,
    faltandoObrigatorias: faltandoObrigatorias.map(([n]) => n),
    faltandoRecomendadas: faltandoRecomendadas.map(([n]) => n),
  };
}

module.exports = { validateEnv, OBRIGATORIAS, RECOMENDADAS };
