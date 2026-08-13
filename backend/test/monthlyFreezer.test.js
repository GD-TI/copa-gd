const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const mesAtual = () => hoje().slice(0, 7);

// ── Banco em memória ────────────────────────────────────────────────────────
const st = {
  linhas: [],      // monthly_rankings
  metas: [],       // monthly_ranking_meta
  ranking: null,   // o que rankingMensal devolve
  erroRanking: null,
  erroPorMes: {},  // { '2026-06': 'mensagem' }
  sql: [],
  invalidados: [],
};

async function executar(text, params = []) {
  st.sql.push(text.trim().split('\n')[0].trim());

  if (text.includes('FROM monthly_ranking_meta WHERE month_ref = ANY')) {
    return { rows: st.metas.filter(m => params[0].includes(m.month_ref)) };
  }
  if (text.includes('FROM monthly_ranking_meta WHERE month_ref = $1')) {
    return { rows: st.metas.filter(m => m.month_ref === params[0]) };
  }
  if (text.includes('FROM monthly_ranking_meta ORDER BY')) {
    return { rows: [...st.metas].sort((a, b) => (a.month_ref < b.month_ref ? 1 : -1)) };
  }
  if (text.includes('DELETE FROM monthly_rankings')) {
    st.linhas = st.linhas.filter(l => l.month_ref !== params[0]);
    return { rows: [] };
  }
  if (text.includes('INSERT INTO monthly_rankings')) {
    const [month_ref, position, vendedor_id, nome, foto, equipe, franquia_nome, contratos, valor, valor_meta] = params;
    st.linhas.push({ month_ref, position, vendedor_id, nome, foto, equipe, franquia_nome, contratos, valor, valor_meta });
    return { rows: [] };
  }
  if (text.includes('INSERT INTO monthly_ranking_meta')) {
    const [month_ref, inicio, fim, participantes, contratos, valor, diagnostics] = params;
    st.metas.push({ month_ref, inicio, fim, participantes, contratos, valor, diagnostics: JSON.parse(diagnostics), frozen_at: '2026-09-01T00:20:00Z' });
    return { rows: [] };
  }
  if (text.includes('FROM monthly_rankings WHERE month_ref')) {
    return { rows: st.linhas.filter(l => l.month_ref === params[0]).sort((a, b) => a.position - b.position) };
  }
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text.trim())) return { rows: [] };
  throw new Error(`query não prevista: ${text.slice(0, 70)}`);
}

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

stub('config/db', {
  query: executar,
  pool: { connect: async () => ({ query: executar, release: () => {} }) },
});

// limitesDoMes é lógica de calendário já testada em rankingIndividual.test.js —
// aqui ela roda de verdade, só a ida à NewCorban é stubada.
const { limitesDoMes, mesAtual: mesAtualReal } = require(path.join(SRC, 'services', 'rankingIndividual'));

stub('services/rankingIndividual', {
  limitesDoMes,
  mesAtual: mesAtualReal,
  rankingMensal: async (mes) => {
    if (st.erroPorMes[mes]) throw new Error(st.erroPorMes[mes]);
    if (st.erroRanking) throw new Error(st.erroRanking);
    return st.ranking;
  },
});

stub('middleware/responseCache', {
  invalidateResponseCache: (prefixos) => { st.invalidados.push(prefixos); },
  responseCache: () => (req, res, next) => next(),
});

const {
  congelarMes, congelarMesesPendentes, lerCongelado, mesesCongelados, pendentes, mesAnterior,
} = require(path.join(SRC, 'services', 'monthlyFreezer'));

function placar(linhas) {
  const board = linhas.map((l, i) => ({
    position: i + 1,
    vendedor_id: String(l.id),
    nome: l.nome,
    foto: l.foto ?? null,
    equipe: l.equipe ?? null,
    franquia_nome: l.franquia ?? null,
    contratos: l.qtd,
    valor: l.valor,
    valor_meta: l.meta ?? 0,
    atingimento: l.meta ? Math.round((l.valor / l.meta) * 10000) / 100 : null,
  }));
  return {
    board,
    totals: {
      contratos: board.reduce((s, v) => s + v.contratos, 0),
      valor: board.reduce((s, v) => s + v.valor, 0),
      participantes: board.length,
    },
    diagnostics: { linhas_api: board.length + 2, nao_humanos: 2, cadastro_ok: true },
  };
}

test.beforeEach(() => {
  st.linhas = [];
  st.metas = [];
  st.ranking = placar([
    { id: 2, nome: 'CAMILLA LIMA', qtd: 168, valor: 401807, meta: 96543, equipe: 'GARRA', franquia: 'Matriz', foto: 'http://cdn/2' },
    { id: 3, nome: 'KAUE MILLER',  qtd: 135, valor: 358786, meta: 77400, equipe: 'GARRA', franquia: 'Matriz' },
  ]);
  st.erroRanking = null;
  st.erroPorMes = {};
  st.sql = [];
  st.invalidados = [];
});

// ── Fila de pendentes ───────────────────────────────────────────────────────

test('mês anterior atravessa a virada do ano', () => {
  assert.equal(mesAnterior('2026-08'), '2026-07');
  assert.equal(mesAnterior('2026-01'), '2025-12');
  assert.equal(mesAnterior('2026-10'), '2026-09');
});

test('pendentes nunca inclui o mês corrente', async () => {
  const fila = await pendentes();
  assert.ok(!fila.includes(mesAtual()), `mês corrente ${mesAtual()} não pode entrar na fila`);
  assert.ok(fila.includes(mesAnterior(mesAtual())));
});

test('pendentes vem do mais antigo para o mais recente', async () => {
  const fila = await pendentes(3);
  assert.deepEqual([...fila].sort(), fila, 'a fila deve estar em ordem crescente');
});

test('mês já congelado sai da fila', async () => {
  const anterior = mesAnterior(mesAtual());
  st.metas.push({ month_ref: anterior, participantes: 2, contratos: 303, valor: 760593 });

  const fila = await pendentes();
  assert.ok(!fila.includes(anterior));
});

// ── Gravação ────────────────────────────────────────────────────────────────

test('congela: grava linhas, meta e invalida o cache', async () => {
  const r = await congelarMes('2026-06');
  assert.equal(r.status, 'congelado');
  assert.equal(r.participantes, 2);

  assert.equal(st.linhas.length, 2);
  assert.equal(st.linhas[0].nome, 'CAMILLA LIMA');
  assert.equal(st.linhas[0].month_ref, '2026-06');
  assert.equal(st.linhas[0].equipe, 'GARRA');

  const [meta] = st.metas;
  assert.equal(meta.participantes, 2);
  assert.equal(meta.contratos, 303);
  assert.equal(meta.diagnostics.cadastro_ok, true);
  assert.equal(meta.inicio, '2026-06-01');
  assert.equal(meta.fim, '2026-06-30');

  assert.deepEqual(st.invalidados, [['/api/rankings']]);
});

test('gravação acontece dentro de uma transação', async () => {
  await congelarMes('2026-06');
  assert.ok(st.sql.includes('BEGIN'), 'faltou BEGIN');
  assert.ok(st.sql.includes('COMMIT'), 'faltou COMMIT');
  assert.ok(st.sql.indexOf('BEGIN') < st.sql.findIndex(s => s.startsWith('INSERT INTO monthly_rankings')));
});

test('congelar é operação única — segunda passada não mexe', async () => {
  await congelarMes('2026-06');
  const antes = st.linhas.length;

  st.ranking = placar([{ id: 9, nome: 'OUTRO', qtd: 1, valor: 1 }]);
  const r = await congelarMes('2026-06');

  assert.equal(r.status, 'ja_congelado');
  assert.equal(st.linhas.length, antes);
  assert.equal(st.linhas[0].nome, 'CAMILLA LIMA', 'o mês fechado não pode ser reescrito');
});

test('mês corrente e mês futuro são recusados', async () => {
  const atual = await congelarMes(mesAtual());
  assert.equal(atual.status, 'recusado');

  const futuro = await congelarMes('2099-01');
  assert.equal(futuro.status, 'recusado');

  assert.equal(st.metas.length, 0);
});

// ── Guardas ─────────────────────────────────────────────────────────────────

test('mês vazio não vira foto — adia para a próxima passada', async () => {
  st.ranking = placar([]);
  const r = await congelarMes('2026-06');

  assert.equal(r.status, 'adiado');
  assert.equal(st.metas.length, 0, 'não pode gravar zero para sempre');
  assert.equal(st.linhas.length, 0);
});

test('mês adiado continua na fila', async () => {
  st.ranking = placar([]);
  const anterior = mesAnterior(mesAtual());
  await congelarMes(anterior);

  const fila = await pendentes();
  assert.ok(fila.includes(anterior), 'sem foto gravada, o mês tem de voltar na fila');
});

test('erro na NewCorban não grava nada', async () => {
  st.erroRanking = 'NewCorban 502';
  await assert.rejects(() => congelarMes('2026-06'), /502/);
  assert.equal(st.metas.length, 0);
  assert.equal(st.linhas.length, 0);
});

test('falha de um mês não impede os outros', async () => {
  const m1 = mesAnterior(mesAtual());
  const m2 = mesAnterior(m1);
  st.erroPorMes[m2] = 'timeout';

  const rs = await congelarMesesPendentes();
  const porMes = Object.fromEntries(rs.map(r => [r.mes, r.status]));

  assert.equal(porMes[m2], 'erro');
  assert.equal(porMes[m1], 'congelado');
  assert.ok(st.metas.some(m => m.month_ref === m1));
});

// ── Leitura de volta ────────────────────────────────────────────────────────

test('o que foi congelado é o que a tela lê de volta', async () => {
  await congelarMes('2026-06');
  const lido = await lerCongelado('2026-06');

  assert.equal(lido.congelado, true);
  assert.equal(lido.ao_vivo, false);
  assert.equal(lido.mes, '2026-06');
  assert.equal(lido.inicio, '2026-06-01');
  assert.equal(lido.fim, '2026-06-30');
  assert.equal(lido.totals.participantes, 2);
  assert.equal(lido.totals.contratos, 303);
  assert.deepEqual(lido.board.map(v => v.nome), ['CAMILLA LIMA', 'KAUE MILLER']);
  assert.equal(lido.board[0].equipe, 'GARRA');
  assert.equal(lido.board[0].foto, 'http://cdn/2');
  assert.ok(lido.diagnostics, 'o diagnóstico da leitura tem de voltar junto');
});

test('atingimento é recalculado na leitura, não guardado', async () => {
  await congelarMes('2026-06');
  const lido = await lerCongelado('2026-06');

  // 401807 / 96543 = 416,19%
  assert.equal(lido.board[0].atingimento, 416.19);
  // Meta zerada vira "não sei", nunca 0% nem divisão por zero
  st.linhas.push({ month_ref: '2026-06', position: 3, vendedor_id: '9', nome: 'SEM META', contratos: 1, valor: 10, valor_meta: 0 });
  const denovo = await lerCongelado('2026-06');
  assert.equal(denovo.board[2].atingimento, null);
});

test('mês nunca congelado devolve null, e não um placar vazio', async () => {
  assert.equal(await lerCongelado('2026-06'), null);
});

test('lista de meses vem do mais recente para o mais antigo', async () => {
  await congelarMes('2026-05');
  await congelarMes('2026-06');

  const meses = await mesesCongelados();
  assert.deepEqual(meses.map(m => m.mes), ['2026-06', '2026-05']);
  assert.equal(meses[0].participantes, 2);
});
