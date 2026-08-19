const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');
const DIA = '2026-08-10';   // sempre no passado

// Sem token, o placar cai na API antiga; estes testes são do caminho v3.
process.env.NEWCORBAN_PROPOSALS_TOKEN = 'nc_live_teste';

function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Estado que cada teste ajusta antes de bater na rota ─────────────────────
const st = {
  campaign: null,
  propostas: {},
  sellers: null,
  robos: null,
  exclusoes: [],
  usuarios: [],
  frozen: [],
  atrasoPropostas: 0,
  atrasoSellers: 0,
  erroSellers: null,
  erroPropostas: null,
  log: [],          // { nome, inicio, fim }
  ttlPropostas: null,
};

function marcar(nome, fn) {
  const inicio = Date.now();
  const reg = { nome, inicio, fim: null };
  st.log.push(reg);
  return Promise.resolve()
    .then(fn)
    .finally(() => { reg.fim = Date.now(); });
}

function stub(rel, exports) {
  const resolved = require.resolve(path.join(SRC, rel));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
}

stub('config/db', {
  query: async (text, params) => {
    if (text.includes('FROM campaigns')) return { rows: st.campaign ? [st.campaign] : [] };
    if (text.includes('campaign_results')) return { rows: st.frozen };
    if (text.includes('ranking_exclusions')) return { rows: st.exclusoes };
    if (text.includes('FROM users')) return { rows: st.usuarios };
    throw new Error(`query não prevista no stub: ${text.slice(0, 60)}`);
  },
});

stub('middleware/auth', {
  authMiddleware: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  adminOnly: (req, res, next) => next(),
  campaignAdminOnly: (req, res, next) => next(),
  // Master: escopo null = todas as franquias. A permissão em si é testada em
  // campaignAccess.test.js e campaignRoutes.test.js; aqui o assunto é o placar.
  attachFranquiaScopes: (req, res, next) => { req.franquiaIds = null; next(); },
});

stub('services/externalApi', {
  getProposalsV3: (start, end, sellers, dateType, stages, ttlMs) => marcar('propostas', async () => {
    st.ttlPropostas = ttlMs;
    if (st.atrasoPropostas) await sleep(st.atrasoPropostas);
    if (st.erroPropostas) throw new Error(st.erroPropostas);
    return st.propostas;
  }),
  getProposals: (start, end, sellers, tipo) => marcar('propostas-legado', async () => {
    st.tipoLegado = tipo;
    if (st.erroPropostas) throw new Error(st.erroPropostas);
    return st.propostasLegado ?? st.propostas;
  }),
});

stub('services/franquiaSellers', {
  getSellerIdsPorFranquia: () => marcar('sellers', async () => {
    if (st.atrasoSellers) await sleep(st.atrasoSellers);
    if (st.erroSellers) throw new Error(st.erroSellers);
    return st.sellers;
  }),
  getRoboSellerIds: () => marcar('robos', async () => st.robos),
});

const campanhas = require(path.join(SRC, 'routes', 'campaigns'));
const { invalidateResponseCache } = require(path.join(SRC, 'middleware', 'responseCache'));

const app = express();
app.use('/api/campaigns', campanhas);
let server, base;

test.before(async () => {
  server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

async function placar(qs = '') {
  const res = await fetch(`${base}/api/campaigns/1/board${qs}`);
  return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
function proposta(id, vendedor, nome, { produto = '13', pago = DIA, cadastro = DIA, valor = 0 } = {}) {
  return [id, {
    vendedor_id: vendedor,
    vendedor_nome: nome,
    equipe_nome: 'GARRA',
    proposta: { valor_referencia: String(valor), produto_id: produto },
    datas: { pagamento: pago, cadastro },
    api: { status_api: 'PAGO' },
  }];
}

function reset({ dia = DIA, status = 'active' } = {}) {
  invalidateResponseCache();
  st.log = [];
  st.ttlPropostas = null;
  st.atrasoPropostas = 0;
  st.atrasoSellers = 0;
  st.erroSellers = null;
  st.erroPropostas = null;
  st.frozen = [];

  st.campaign = {
    id: 1, name: 'Missão Resgate', subtitle: 'x',
    start_date: dia, end_date: dia,
    color: 'laranja', metric: 'contratos',
    product_ids: ['13'], require_same_day: true, franquia_ids: ['matriz'],
    ladder: [{ at: 5, prize: 20 }, { at: 10, prize: 20 }, { at: 15, prize: 30 }, { at: 20, prize: 40 }, { at: 25, prize: 50 }],
    ladder_step: { every: 5, prize: 20 },
    spin_every: 5, status,
  };

  st.sellers = new Set(['10', '11', '12', '13', '14']);
  st.robos = new Set(['13']);
  st.exclusoes = [{ corban_id: null, name_pattern: 'API%' }];
  st.usuarios = [{ corban_id: '12', nome: 'CARLA SOUZA' }];

  st.propostas = Object.fromEntries([
    proposta('p1',  '10', 'ANA LIMA',        { valor: 1000, pago: dia, cadastro: dia }),
    proposta('p2',  '10', 'ANA LIMA',        { valor: 2500, pago: dia, cadastro: dia }),
    proposta('p3',  '11', 'BRUNO DIAS',      { valor: 5000, pago: dia, cadastro: dia }),
    proposta('p4',  '11', 'BRUNO DIAS',      { valor: 900,  pago: dia, cadastro: '2026-08-09' }),
    proposta('p5',  '11', 'BRUNO DIAS',      { valor: 800,  pago: dia, cadastro: dia, produto: '7' }),
    proposta('p6',  '99', 'FORA DA MATRIZ',  { valor: 400,  pago: dia, cadastro: dia }),
    proposta('p7',  '13', 'NOVA IA',         { valor: 300,  pago: dia, cadastro: dia }),
    proposta('p8',  '12', '',                { valor: 700,  pago: dia, cadastro: dia }),
    proposta('p9',  '10', 'ANA LIMA',        { valor: 100,  pago: '2026-08-09', cadastro: dia }),
    proposta('p10', '14', 'API INTEGRACAO',  { valor: 200,  pago: dia, cadastro: dia }),
  ]);
}

// ── Testes ──────────────────────────────────────────────────────────────────

test('placar monta o mesmo resultado de sempre (filtros, ordem, escada, diagnóstico)', async () => {
  reset();
  const { status, body } = await placar();

  assert.equal(status, 200);
  assert.equal(body.date, DIA);
  assert.equal(body.frozen, false);

  assert.deepEqual(body.board.map(v => [v.position, v.vendor_id, v.vendor_name, v.contracts, v.total_value]), [
    [1, '10', 'ANA LIMA',    2, 3500],
    [2, '11', 'BRUNO DIAS',  1, 5000],
    [3, '12', 'CARLA SOUZA', 1, 700],   // nome veio da tabela users
  ]);

  // escada cumulativa: ninguém chegou a 5, todos apontam para o primeiro degrau
  assert.deepEqual(body.board.map(v => [v.prize_value, v.spins, v.next_at, v.next_prize, v.missing]), [
    [0, 0, 5, 20, 3],
    [0, 0, 5, 20, 4],
    [0, 0, 5, 20, 4],
  ]);

  assert.deepEqual(body.totals, { contracts: 4, value: 9200, participants: 3 });

  assert.deepEqual(body.diagnostics, {
    paid_today: 9,                          // p9 é de outro dia e nem entra
    excluded_non_human: 2,                  // robô (13) + padrão API% (14)
    other_product: 1,                       // produto 7
    paid_but_registered_another_day: 1,     // cadastro em 09
    other_franquia: 1,                      // vendedor 99
    franquia_ids: ['matriz'],
    franquia_sellers: 5,
    source: 'v3',
  });
});

test('Jarvis e Maia não entram no placar mesmo sem flag de robô', async () => {
  reset();
  st.sellers.add('15');
  st.sellers.add('16');
  st.propostas.p11 = proposta('p11', '15', 'JARVIS (API)', { valor: 9000, pago: DIA, cadastro: DIA })[1];
  st.propostas.p12 = proposta('p12', '16', 'MAIA', { valor: 8000, pago: DIA, cadastro: DIA })[1];

  const { status, body } = await placar();
  assert.equal(status, 200);
  assert.deepEqual(body.board.map(v => v.vendor_name), ['ANA LIMA', 'BRUNO DIAS', 'CARLA SOUZA']);
  assert.equal(body.diagnostics.excluded_non_human, 4);
});

test('propostas e cadastro de consultores vão em paralelo', async () => {
  reset();
  st.atrasoPropostas = 80;
  st.atrasoSellers = 80;

  const t0 = Date.now();
  const { status } = await placar();
  const total = Date.now() - t0;

  assert.equal(status, 200);

  const props = st.log.find(l => l.nome === 'propostas');
  const sellers = st.log.find(l => l.nome === 'sellers');
  assert.ok(sellers.inicio < props.fim, 'o cadastro deve começar antes de as propostas terminarem');
  assert.ok(total < 150, `esperado ~80ms (paralelo), veio ${total}ms — parece estar em série`);
});

test('dia encerrado usa TTL longo; dia corrente mantém o curto', async () => {
  reset({ dia: DIA });
  await placar();
  assert.equal(st.ttlPropostas, 600_000, 'dia passado: 10 min');

  reset({ dia: hojeBR() });
  await placar();
  assert.equal(st.ttlPropostas, 60_000, 'dia corrente: 60s, como era antes');
});

test('recálculo de pontos não derruba mais o cache do placar', async () => {
  reset();
  assert.equal((await placar()).cache, 'MISS');
  assert.equal((await placar()).cache, 'HIT');

  // é o que o broadcast('scores_updated') faz a cada rodada do cron
  const { broadcast } = require(path.join(SRC, 'routes', 'events'));
  broadcast('scores_updated', { ts: Date.now() });

  assert.equal((await placar()).cache, 'HIT', 'o placar não deriva de score_events');
});

test('cadastro de consultores indisponível continua virando 502', async () => {
  reset();
  st.erroSellers = 'Cadastro de consultores do NewCorban veio vazio';

  const { status, body } = await placar();
  assert.equal(status, 502);
  assert.equal(body.error, 'Não foi possível carregar o placar');
  assert.equal(body.detail, 'Cadastro de consultores do NewCorban veio vazio');
});

test('quando propostas e cadastro falham juntos, o erro relatado é o das propostas', async () => {
  reset();
  st.erroPropostas = 'NC v3: 429';
  st.erroSellers = 'cadastro fora do ar';

  const rejeicoes = [];
  const onRejection = e => rejeicoes.push(e);
  process.on('unhandledRejection', onRejection);

  const { status, body } = await placar();
  await sleep(50);
  process.off('unhandledRejection', onRejection);

  assert.equal(status, 502);
  assert.equal(body.detail, 'NC v3: 429', 'mesma ordem de erro de antes');
  assert.deepEqual(rejeicoes, [], 'nenhuma promise pode ficar rejeitada sem dono');
});

test('campanha encerrada com resultado congelado não chama a API', async () => {
  reset({ status: 'closed' });
  st.frozen = [
    { position: 1, vendor_id: '10', vendor_name: 'ANA LIMA', team: 'GARRA', contracts: '7', total_value: '9000', prize_value: '40', spins: 1 },
    { position: 2, vendor_id: '11', vendor_name: 'BRUNO DIAS', team: null, contracts: '3', total_value: '400', prize_value: '0', spins: 0 },
  ];
  st.log = [];

  const { status, body } = await placar();
  assert.equal(status, 200);
  assert.equal(body.frozen, true);
  assert.deepEqual(body.totals, { contracts: 10, value: 9400, participants: 2 });
  assert.equal(st.log.length, 0, 'caminho congelado não pode tocar a NewCorban');
});

test('placar congelado traz os campos que o telão renderiza', async () => {
  reset({ status: 'closed' });
  st.frozen = [
    { position: 1, vendor_id: '10', vendor_name: 'ANA LIMA', team: 'GARRA', contracts: '7', total_value: '9000', prize_value: '40', spins: 1 },
  ];
  st.campaign.frozen_diagnostics = { paid_today: 31, other_product: 4, excluded_non_human: 2 };

  const { body } = await placar();
  const [linha] = body.board;

  // Sem estes três o telão mostrava "faltam undefined para o próximo giro"
  assert.equal(linha.next_at, 10, 'próximo degrau da escada');
  assert.equal(linha.next_prize, 20);
  assert.equal(linha.missing, 3);

  assert.equal(linha.team, 'GARRA');
  assert.equal(typeof linha.contracts, 'number');
  assert.equal(typeof linha.total_value, 'number');
  assert.equal(body.diagnostics.paid_today, 31, 'a linha "não entraram" precisa do diagnóstico');
  assert.equal(body.date, DIA);
});

test('sem token da v3, o placar sai pela API antiga e diz de onde veio', async () => {
  reset();
  delete process.env.NEWCORBAN_PROPOSALS_TOKEN;
  try {
    const { status, body } = await placar();

    assert.equal(status, 200);
    assert.equal(body.diagnostics.source, 'legado');
    assert.equal(st.tipoLegado, 'pagamento', 'a antiga precisa filtrar por data de pagamento');
    assert.ok(st.log.some(l => l.nome === 'propostas-legado'));
    assert.ok(!st.log.some(l => l.nome === 'propostas'), 'não pode tocar a v3 sem token');

    // mesmo dado, mesmo placar
    assert.deepEqual(body.board.map(v => [v.vendor_id, v.contracts, v.total_value]), [
      ['10', 2, 3500], ['11', 1, 5000], ['12', 1, 700],
    ]);
  } finally {
    process.env.NEWCORBAN_PROPOSALS_TOKEN = 'nc_live_teste';
  }
});

test('a API antiga não tem stage=paid — cancelada é descartada aqui', async () => {
  reset();
  delete process.env.NEWCORBAN_PROPOSALS_TOKEN;
  try {
    st.propostasLegado = {
      ...st.propostas,
      cancelada: {
        vendedor_id: '10', vendedor_nome: 'ANA LIMA', equipe_nome: 'GARRA',
        proposta: { valor_referencia: '99999', produto_id: '13' },
        datas: { pagamento: DIA, cadastro: DIA },
        api: { status_api: 'CANCELADA' },
      },
      estornada: {
        vendedor_id: '10', vendedor_nome: 'ANA LIMA', equipe_nome: 'GARRA',
        proposta: { valor_referencia: '77777', produto_id: '13' },
        datas: { pagamento: DIA, cadastro: DIA, cancelado: '2026-08-10 18:00:00' },
        api: { status_api: 'APROVADA' },
      },
    };

    const { body } = await placar();
    const ana = body.board.find(v => v.vendor_id === '10');
    assert.equal(ana.contracts, 2, 'cancelada e estornada não podem virar contrato');
    assert.equal(ana.total_value, 3500);
    assert.equal(body.diagnostics.paid_today, 9, 'nem entram na contagem do dia');
  } finally {
    process.env.NEWCORBAN_PROPOSALS_TOKEN = 'nc_live_teste';
    st.propostasLegado = null;
  }
});

test('?date= em campanha encerrada não recebe o snapshot de outro dia', async () => {
  reset({ status: 'closed' });
  st.frozen = [
    { position: 1, vendor_id: '10', vendor_name: 'ANA LIMA', team: '', contracts: '7', total_value: '9000', prize_value: '40', spins: 1 },
  ];
  st.log = [];

  const { body } = await placar('?date=2026-08-09');
  assert.equal(body.frozen, false, 'outro dia precisa ser reconstruído');
  assert.equal(body.date, '2026-08-09');
  assert.ok(st.log.some(l => l.nome === 'propostas'), 'deve ter ido à API');
});

// ── Campanha legada (Copa GD 2026 arquivada) ────────────────────────────────
// Forma de dados totalmente diferente: ranking de equipes + individuais já
// prontos no banco, sem escada, sem giro e sem NewCorban.

function legada({ snapshot } = {}) {
  reset({ status: 'closed' });
  st.campaign.legacy_kind = 'team_scoring';
  st.campaign.name = 'Copa GD 2026';
  st.campaign.legacy_snapshot = snapshot === undefined ? {
    groups: [
      { id: 1, name: 'Holanda', total_points: '875', goal_points: 900, member_count: 5 },
      { id: 2, name: 'Bélgica', total_points: '835', goal_points: 900, member_count: 5 },
    ],
    indRankings: {
      melhor_vendedor:  [{ vendedor_id: '10', name: 'CAMILLA LIMA', total_valor: 1078860.3 }],
      rei_assistencias: [{ vendedor_id: '11', name: 'KAUE MILLER',  indicacao_count: 9 }],
    },
  } : snapshot;
  st.log = [];
}

test('campanha legada serve o snapshot arquivado sem tocar a NewCorban', async () => {
  legada();

  const { status, body } = await placar();
  assert.equal(status, 200);
  assert.equal(body.legacy, true);
  assert.equal(body.frozen, true);
  assert.equal(body.campaign.name, 'Copa GD 2026');
  assert.deepEqual(body.snapshot.groups.map(g => g.name), ['Holanda', 'Bélgica']);
  assert.equal(body.snapshot.indRankings.melhor_vendedor[0].name, 'CAMILLA LIMA');
  assert.equal(body.snapshot.indRankings.rei_assistencias[0].indicacao_count, 9);
  assert.equal(st.log.length, 0, 'arquivo é leitura de banco: não pode tocar a NewCorban');
});

test('legada vence campaign_results — nunca vira placar por escada', async () => {
  legada();
  // Uma linha legada não deveria ter resultado por vendedor, mas se tiver
  // (lixo, migration antiga), o ramo legado precisa ganhar: interpretar isso
  // como placar de giro devolveria uma tela sem sentido para a Copa.
  st.frozen = [
    { position: 1, vendor_id: '10', vendor_name: 'ANA LIMA', team: 'GARRA', contracts: '7', total_value: '9000', prize_value: '40', spins: 1 },
  ];

  const { body } = await placar();
  assert.equal(body.legacy, true);
  assert.ok(body.snapshot, 'precisa vir o snapshot de equipes/individuais');
  assert.equal(body.board, undefined, 'não pode montar board por vendedor');
});

test('legada sem snapshot devolve forma vazia em vez de quebrar o telão', async () => {
  legada({ snapshot: null });

  const { status, body } = await placar();
  assert.equal(status, 200);
  assert.equal(body.legacy, true);
  // O Telao faz groups.reduce(...) e lê indRankings.melhor_vendedor: sem estes
  // defaults, um snapshot ausente virava tela branca com TypeError.
  assert.deepEqual(body.snapshot.groups, []);
  assert.deepEqual(body.snapshot.indRankings, { melhor_vendedor: [], rei_assistencias: [] });
});
