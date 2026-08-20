const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// ── Estado que cada teste ajusta antes de chamar o serviço ──────────────────
const st = {
  resultado: {},        // payload cru do ranking.php
  robos: null,
  info: null,
  exclusoes: [],
  erroRanking: null,
  erroRobos: false,
  erroInfo: false,
  erroExclusoes: false,
  chamadas: [],         // { inicio, fim, tipo, opts }
};

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

stub('config/db', {
  query: async (text) => {
    if (text.includes('ranking_exclusions')) {
      if (st.erroExclusoes) throw new Error('banco fora');
      return { rows: st.exclusoes };
    }
    throw new Error(`query não prevista: ${text.slice(0, 60)}`);
  },
});

// O normalizarRanking real é o que sabe desenterrar a foto do `second_level`;
// stubá-lo esconderia justamente a parte frágil. Só o transporte é stubado.
const { normalizarRanking } = require(path.join(SRC, 'services', 'externalApi'));

stub('services/externalApi', {
  getRankingPeriodo: async (inicio, fim, tipo, opts) => {
    st.chamadas.push({ inicio, fim, tipo, opts });
    if (st.erroRanking) throw new Error(st.erroRanking);
    return st.resultado;
  },
  normalizarRanking,
});

stub('services/franquiaSellers', {
  getRoboSellerIds: async () => {
    if (st.erroRobos) throw new Error('cadastro fora');
    return st.robos;
  },
  getInfoVendedores: async () => {
    if (st.erroInfo) throw new Error('cadastro fora');
    return st.info;
  },
});

const {
  rankingMensal, digitadosDoDia, limitesDoMes,
  TTL_JANELA_VIVA, TTL_JANELA_FECHADA,
} = require(path.join(SRC, 'services', 'rankingIndividual'));

/** Monta o payload do ranking.php a partir de linhas simples. */
function payload(linhas) {
  const result = {};
  for (const l of linhas) {
    result[l.nome] = {
      name: l.nome,
      filter_value: String(l.id),
      qtd_propostas: l.qtd ?? 0,
      valor_referencia: l.valor ?? 0,
      valor_meta: l.meta ?? 0,
      valor_liberado: 0,
      valor_financiado: 0,
      second_level: { [l.nome]: { filter_value: String(l.id), image: l.foto ?? null } },
    };
  }
  return { result };
}

test.beforeEach(() => {
  st.resultado = {};
  st.robos = new Set();
  st.info = null;
  st.exclusoes = [];
  st.erroRanking = null;
  st.erroRobos = false;
  st.erroInfo = false;
  st.erroExclusoes = false;
  st.chamadas = [];
});

// ── Janela do mês ───────────────────────────────────────────────────────────

test('mês corrente para em hoje; mês passado vai até o último dia', () => {
  const mesAtual = hoje().slice(0, 7);
  const atual = limitesDoMes(mesAtual);
  assert.equal(atual.inicio, `${mesAtual}-01`);
  assert.equal(atual.fim, hoje());
  assert.equal(atual.ao_vivo, true);

  const passado = limitesDoMes('2026-07');
  assert.equal(passado.inicio, '2026-07-01');
  assert.equal(passado.fim, '2026-07-31');
  assert.equal(passado.ao_vivo, false);
});

test('último dia do mês respeita fevereiro e ano bissexto', () => {
  assert.equal(limitesDoMes('2025-02').fim, '2025-02-28');
  assert.equal(limitesDoMes('2024-02').fim, '2024-02-29');
  assert.equal(limitesDoMes('2026-04').fim, '2026-04-30');
});

test('mês malformado ou inexistente é recusado', () => {
  assert.throws(() => limitesDoMes('2026-8'), /inválido/);
  assert.throws(() => limitesDoMes('agosto'), /inválido/);
  assert.throws(() => limitesDoMes('2026-13'), /inválido/);
  assert.throws(() => limitesDoMes(''), /inválido/);
});

test('mês futuro devolve lista vazia sem tocar na NewCorban', async () => {
  const r = await rankingMensal('2099-01');
  assert.deepEqual(r.board, []);
  assert.equal(r.totals.participantes, 0);
  assert.equal(st.chamadas.length, 0);
});

test('data de digitados malformada é recusada', async () => {
  await assert.rejects(() => digitadosDoDia('10/08/2026'), /inválida/);
  await assert.rejects(() => digitadosDoDia('2026-8-1'), /inválida/);
});

// ── Contas não-humanas ──────────────────────────────────────────────────────

test('robô do cadastro e padrão de nome saem os dois', async () => {
  st.resultado = payload([
    { nome: 'NOVA IA',   id: 24693, qtd: 270, valor: 25868 },   // flag do cadastro
    { nome: 'Jarvis (API', id: 1013, qtd: 268, valor: 690524 }, // não casa com padrão nem flag
    { nome: 'BOT - Guarulhos', id: 2791, qtd: 39, valor: 93110 }, // padrão de nome
    { nome: 'WASHINGTON RUAS', id: 4875, qtd: 36, valor: 47399 },
  ]);
  st.robos = new Set(['24693', '1013']);
  st.exclusoes = [{ corban_id: null, name_pattern: 'BOT %' }];

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(r.board.map(v => v.nome), ['WASHINGTON RUAS']);
  assert.equal(r.diagnostics.nao_humanos, 3);
});

test('Jarvis, Maia e qualquer conta nomeada como IA saem mesmo sem flag ou banco', async () => {
  st.resultado = payload([
    { nome: 'Jarvis (API)', id: 1013, qtd: 268, valor: 690524 },
    { nome: 'MAIA',         id: 4401, qtd: 190, valor: 410000 },
    { nome: 'NOVA IA',      id: 24693, qtd: 270, valor: 25868 },
    { nome: 'IA VENDAS',    id: 4402, qtd: 80,  valor: 90000 },
    { nome: 'MARIANA LIMA', id: 4403, qtd: 36,  valor: 47399 },
  ]);
  st.robos = new Set();
  st.exclusoes = [];

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(r.board.map(v => v.nome), ['MARIANA LIMA']);
  assert.equal(r.diagnostics.nao_humanos, 4);
});

test('exclusão por corban_id também vale', async () => {
  st.resultado = payload([
    { nome: 'ALGUEM', id: 99, qtd: 10, valor: 100 },
    { nome: 'OUTRO',  id: 77, qtd: 5,  valor: 50 },
  ]);
  st.exclusoes = [{ corban_id: '99', name_pattern: null }];

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(r.board.map(v => v.vendedor_id), ['77']);
});

test('cadastro fora do ar ainda filtra pelos padrões de nome', async () => {
  st.resultado = payload([
    { nome: 'API Integracao', id: 1, qtd: 90, valor: 900 },
    { nome: 'HUMANO',         id: 2, qtd: 10, valor: 100 },
  ]);
  st.erroRobos = true;
  st.exclusoes = [{ corban_id: null, name_pattern: 'API%' }];

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(r.board.map(v => v.nome), ['HUMANO']);
  assert.equal(r.diagnostics.cadastro_ok, false);
  assert.equal(r.diagnostics.exclusoes_ok, true);
});

test('sem cadastro E sem exclusões o serviço se recusa a responder', async () => {
  st.resultado = payload([{ nome: 'NOVA IA', id: 24693, qtd: 270, valor: 25868 }]);
  st.erroRobos = true;
  st.erroExclusoes = true;

  // Servir aqui seria colocar a IA no topo de uma TV — pior que não responder.
  await assert.rejects(() => digitadosDoDia('2026-08-11'), /robô/);
});

test('falha do ranking em si sobe para quem chamou', async () => {
  st.erroRanking = 'NewCorban 502';
  await assert.rejects(() => rankingMensal('2026-07'), /502/);
});

// ── Ordenação ───────────────────────────────────────────────────────────────

test('mensal ordena por R$ pago, com contratos no desempate', async () => {
  st.resultado = payload([
    { nome: 'WASHINGTON', id: 1, qtd: 157, valor: 101668 },
    { nome: 'CAMILLA',    id: 2, qtd: 168, valor: 401807 },
    { nome: 'KAUE',       id: 3, qtd: 135, valor: 358786 },
    { nome: 'EMPATE_A',   id: 4, qtd: 10,  valor: 101668 },
  ]);

  const r = await rankingMensal('2026-07');
  assert.deepEqual(r.board.map(v => v.nome), ['CAMILLA', 'KAUE', 'WASHINGTON', 'EMPATE_A']);
  assert.deepEqual(r.board.map(v => v.position), [1, 2, 3, 4]);
  // Mesmo valor: quem tem mais contratos fica na frente, e não a ordem do payload
  assert.equal(r.board[2].nome, 'WASHINGTON');
});

test('digitados ordena por R$ de referência, com quantidade no desempate', async () => {
  st.resultado = payload([
    { nome: 'BEATRIZ',    id: 1, qtd: 26, valor: 18850 },
    { nome: 'WASHINGTON', id: 2, qtd: 36, valor: 47399 },
    // Digitou MAIS linhas que o WASHINGTON e mesmo assim fica atrás: quem manda
    // é o valor. Era o líder quando a ordem era por quantidade (até 20/08/2026).
    { nome: 'MUITA_LINHA_POUCO_VALOR', id: 3, qtd: 40, valor: 900 },
    { nome: 'EMPATE_MENOS_LINHAS',     id: 4, qtd: 12, valor: 18850 },
  ]);

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(
    r.board.map(v => v.nome),
    ['WASHINGTON', 'BEATRIZ', 'EMPATE_MENOS_LINHAS', 'MUITA_LINHA_POUCO_VALOR']
  );
});

test('linha sem movimento não vira participante', async () => {
  st.resultado = payload([
    { nome: 'ATIVO',  id: 1, qtd: 5, valor: 500 },
    { nome: 'PARADO', id: 2, qtd: 0, valor: 0 },
  ]);

  const r = await digitadosDoDia('2026-08-11');
  assert.deepEqual(r.board.map(v => v.nome), ['ATIVO']);
  assert.equal(r.diagnostics.sem_movimento, 1);
  assert.equal(r.totals.participantes, 1);
});

// ── Campos da linha ─────────────────────────────────────────────────────────

test('procedência e foto entram na linha; ausência não quebra', async () => {
  st.resultado = payload([
    { nome: 'COM_TUDO', id: 1, qtd: 5, valor: 500, meta: 250, foto: 'http://cdn/1' },
    { nome: 'SEM_NADA', id: 2, qtd: 4, valor: 400 },
  ]);
  st.info = new Map([['1', { equipe: 'PROPÓSITO', franquia: 'matriz', franquia_nome: 'Matriz' }]]);

  const r = await rankingMensal('2026-07');
  const [a, b] = r.board;
  assert.equal(a.equipe, 'PROPÓSITO');
  assert.equal(a.franquia_nome, 'Matriz');
  assert.equal(a.foto, 'http://cdn/1');
  assert.equal(a.atingimento, 200);      // 500 / 250

  assert.equal(b.equipe, null);
  assert.equal(b.foto, null);
  // Meta zerada não vira divisão por zero nem 0%: vira "não sei"
  assert.equal(b.atingimento, null);
});

test('cadastro de procedência indisponível não derruba o ranking', async () => {
  st.resultado = payload([{ nome: 'ALGUEM', id: 1, qtd: 5, valor: 500 }]);
  st.erroInfo = true;

  const r = await rankingMensal('2026-07');
  assert.equal(r.board.length, 1);
  assert.equal(r.board[0].equipe, null);
  assert.equal(r.diagnostics.procedencia_ok, false);
});

test('totais somam o que está no board, não o que veio da API', async () => {
  st.resultado = payload([
    { nome: 'HUMANO', id: 1, qtd: 10, valor: 1000 },
    { nome: 'ROBO',   id: 2, qtd: 500, valor: 99999 },
  ]);
  st.robos = new Set(['2']);

  const r = await digitadosDoDia('2026-08-11');
  assert.equal(r.totals.contratos, 10);
  assert.equal(r.totals.valor, 1000);
  assert.equal(r.diagnostics.linhas_api, 2);
});

// ── Janela e frescor ────────────────────────────────────────────────────────

test('mensal consulta por pagamento; digitados consulta por cadastro', async () => {
  await rankingMensal('2026-07');
  await digitadosDoDia('2026-08-11');

  assert.equal(st.chamadas[0].tipo, 'pagamento');
  assert.deepEqual([st.chamadas[0].inicio, st.chamadas[0].fim], ['2026-07-01', '2026-07-31']);

  assert.equal(st.chamadas[1].tipo, 'cadastro');
  assert.deepEqual([st.chamadas[1].inicio, st.chamadas[1].fim], ['2026-08-11', '2026-08-11']);
});

test('janela encerrada pede TTL longo; janela corrente pede TTL curto', async () => {
  await rankingMensal('2026-07');
  assert.equal(st.chamadas[0].opts.ttlMs, TTL_JANELA_FECHADA);

  st.chamadas = [];
  await rankingMensal(hoje().slice(0, 7));
  assert.equal(st.chamadas[0].opts.ttlMs, TTL_JANELA_VIVA);

  st.chamadas = [];
  await digitadosDoDia(hoje());
  assert.equal(st.chamadas[0].opts.ttlMs, TTL_JANELA_VIVA);
});
