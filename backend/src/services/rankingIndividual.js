const { getRankingPeriodo, normalizarRanking } = require('./externalApi');
const { getRoboSellerIds, getInfoVendedores } = require('./franquiaSellers');
const { buildExcluder, carregarExclusoes } = require('./rankingFilters');

/**
 * Ranking individual da empresa — mensal por contratos pagos e diário por
 * contratos digitados.
 *
 * Duas decisões moldam este arquivo:
 *
 * 1. **Não existe reset.** "Zera todo mês" e "zera todo dia" são a janela da
 *    consulta, não um evento: no dia 1º às 00:00 o mês novo já começa vazio
 *    porque `limitesDoMes` passa a apontar para outro intervalo. Não há tabela
 *    para limpar, cron de virada nem `daily_calculations` — todo o maquinário
 *    de `score_events` fica de fora deste caminho.
 *
 * 2. **A fonte é o `ranking.php`, não a v3.** Ele já devolve o agregado por
 *    vendedor numa requisição, sem paginação: ~2s para a empresa inteira,
 *    contra mais de 9 minutos da v3 paginada de 100 em 100 para o mesmo mês
 *    (medido em 11/08/2026). Ver `getRankingPeriodo` em `externalApi.js`.
 *
 * Escopo: **empresa inteira** (matriz e franquias), decisão do cliente em
 * 12/08/2026. Só saem contas não-humanas.
 */

// Frescor: janela corrente ainda recebe venda, janela fechada não.
const TTL_JANELA_VIVA = 60_000;
const TTL_JANELA_FECHADA = 10 * 60_000;

// Os mesmos produtos que o resto do app consulta (7 e 13).
const PRODUTOS = ['7', '13'];

/** Data de hoje no fuso de São Paulo (en-CA formata como YYYY-MM-DD). */
function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Mês corrente no formato YYYY-MM. */
function mesAtual() {
  return hojeBR().slice(0, 7);
}

/**
 * Início e fim da janela de um mês.
 *
 * Datas tratadas como string, nunca via `new Date('2026-08-01')` — esse
 * construtor interpreta como UTC e no fuso de Brasília volta um dia, armadilha
 * que já mordeu as abas de fase em `ShellCampaigns.jsx`. O único uso de `Date`
 * aqui é `Date.UTC(ano, mes, 0)`, que é aritmética de calendário em UTC puro e
 * devolve o último dia do mês pedido.
 */
function limitesDoMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) {
    throw new Error(`Mês inválido: "${mes}" (esperado YYYY-MM)`);
  }

  const [ano, m] = mes.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error(`Mês inválido: "${mes}"`);

  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const inicio = `${mes}-01`;
  const fimDoMes = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

  const hoje = hojeBR();
  const mesDeHoje = hoje.slice(0, 7);

  return {
    inicio,
    // Mês corrente para no dia de hoje; mês passado vai até o fim.
    fim: mes === mesDeHoje ? hoje : fimDoMes,
    fim_do_mes: fimDoMes,
    ao_vivo: mes === mesDeHoje,
    futuro: mes > mesDeHoje,
  };
}

/**
 * Consulta o ranking.php e devolve só gente, com procedência.
 *
 * `getRoboSellerIds` e `carregarExclusoes` cobrem coisas diferentes: o primeiro
 * lê a flag `robo` do cadastro (pega "NOVA IA", que não casa com padrão de
 * nome), o segundo pega padrões como `API%` e `BOT %`. Se **os dois** falharem
 * a função lança, em vez de servir um ranking liderado pela IA numa TV.
 */
async function agregar({ inicio, fim, tipo, ttlMs, ordenarPor }) {
  const [rankRes, robosRes, infoRes, excRes] = await Promise.allSettled([
    getRankingPeriodo(inicio, fim, tipo, { produtos: PRODUTOS, ttlMs }),
    getRoboSellerIds(),
    getInfoVendedores(),
    carregarExclusoes(),
  ]);

  // O ranking em si é obrigatório: sem ele não há o que mostrar.
  if (rankRes.status === 'rejected') throw rankRes.reason;

  const robos = robosRes.status === 'fulfilled' ? robosRes.value : null;
  const info = infoRes.status === 'fulfilled' ? infoRes.value : null;
  const exclusoes = excRes.status === 'fulfilled' ? excRes.value : null;

  if (!robos && !exclusoes) {
    throw new Error(
      'Sem cadastro de consultores e sem lista de exclusões — o ranking sairia ' +
      'liderado por contas de robô. Preferimos não responder.'
    );
  }

  const isExcluded = buildExcluder(exclusoes || []);
  const linhas = normalizarRanking(rankRes.value);

  let naoHumanos = 0;
  let semMovimento = 0;
  const vivos = [];

  for (const v of linhas) {
    if (v.contratos <= 0 && v.valor <= 0) { semMovimento++; continue; }
    if (robos?.has(v.vendedor_id) || isExcluded(v.vendedor_id, v.nome)) { naoHumanos++; continue; }
    vivos.push(v);
  }

  // Volume desempata valor e vice-versa: duas pessoas com o mesmo número não
  // podem trocar de lugar a cada recarga da tela.
  const ordem = ordenarPor === 'valor'
    ? (a, b) => b.valor - a.valor || b.contratos - a.contratos
    : (a, b) => b.contratos - a.contratos || b.valor - a.valor;

  const board = vivos.sort(ordem).map((v, i) => {
    const proc = info?.get(v.vendedor_id) || null;
    return {
      position: i + 1,
      vendedor_id: v.vendedor_id,
      nome: v.nome,
      foto: v.foto,
      equipe: proc?.equipe || null,
      franquia_nome: proc?.franquia_nome || null,
      contratos: v.contratos,
      valor: Math.round(v.valor * 100) / 100,
      valor_meta: Math.round(v.valor_meta * 100) / 100,
      // A meta da NewCorban é derivada do contrato, não uma meta mensal do
      // consultor — por isso quase todo mundo fica entre 200% e 500%. Vai para
      // a tela como coluna de apoio, nunca como critério de ordenação.
      atingimento: v.valor_meta > 0 ? Math.round((v.valor / v.valor_meta) * 10000) / 100 : null,
    };
  });

  return {
    board,
    totals: {
      contratos: board.reduce((s, v) => s + v.contratos, 0),
      valor: Math.round(board.reduce((s, v) => s + v.valor, 0) * 100) / 100,
      participantes: board.length,
    },
    // Distingue "ninguém vendeu" de "o filtro comeu todo mundo" — foi o que
    // evitou horas de dúvida no placar de campanha.
    diagnostics: {
      linhas_api: linhas.length,
      nao_humanos: naoHumanos,
      sem_movimento: semMovimento,
      cadastro_ok: Boolean(robos),
      exclusoes_ok: Boolean(exclusoes),
      procedencia_ok: Boolean(info),
      produtos: PRODUTOS,
    },
  };
}

/**
 * Ranking do mês por contratos **pagos**, ordenado por R$ (decisão do cliente,
 * 12/08/2026). Sábado e domingo contam: o recorte de dia útil era regra da Copa
 * e não existe no ranking da NewCorban.
 */
async function rankingMensal(mes = mesAtual()) {
  const janela = limitesDoMes(mes);

  if (janela.futuro) {
    return {
      mes, ...janela, congelado: false,
      board: [], totals: { contratos: 0, valor: 0, participantes: 0 },
      diagnostics: { motivo: 'mês ainda não começou' },
    };
  }

  const agregado = await agregar({
    inicio: janela.inicio,
    fim: janela.fim,
    tipo: 'pagamento',
    ttlMs: janela.ao_vivo ? TTL_JANELA_VIVA : TTL_JANELA_FECHADA,
    ordenarPor: 'valor',
  });

  return { mes, ...janela, congelado: false, ...agregado };
}

/**
 * Contratos **digitados** no dia, ordenado por **valor de referência**
 * (decisão do cliente, 20/08/2026) — a quantidade entra só como desempate.
 * Conta tudo que foi digitado, pago ou não.
 *
 * Ordenava por quantidade antes, porque é o que a palavra "digitados" nomeia;
 * o que o cliente quer ver no topo é quem digitou mais dinheiro, não quem
 * digitou mais linhas. A tela acompanha: o número grande da variante
 * `digitados` passou a ser o R$, com a contagem no apoio — número grande fora
 * da ordem do ranking faz a lista parecer desordenada.
 */
async function digitadosDoDia(dia = hojeBR()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) {
    throw new Error(`Data inválida: "${dia}" (esperado YYYY-MM-DD)`);
  }

  const aoVivo = dia === hojeBR();
  const agregado = await agregar({
    inicio: dia,
    fim: dia,
    tipo: 'cadastro',
    ttlMs: aoVivo ? TTL_JANELA_VIVA : TTL_JANELA_FECHADA,
    ordenarPor: 'valor',
  });

  return { dia, ao_vivo: aoVivo, ...agregado };
}

module.exports = {
  rankingMensal,
  digitadosDoDia,
  limitesDoMes,
  hojeBR,
  mesAtual,
  PRODUTOS,
  TTL_JANELA_VIVA,
  TTL_JANELA_FECHADA,
};
