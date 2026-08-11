const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const DIA = '2026-08-10';   // sempre no passado

process.env.NEWCORBAN_PROPOSALS_TOKEN = 'nc_live_teste';

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// ── Banco em memória ────────────────────────────────────────────────────────
const st = {
  campanhas: [],
  resultados: [],       // linhas de campaign_results
  propostas: {},
  sellers: null,
  robos: null,
  erroPropostas: null,
  sql: [],              // toda query executada, para inspecionar transação
};

async function executar(text, params = []) {
  st.sql.push(text.trim().split('\n')[0].trim());

  if (text.includes('FROM campaigns c')) {                      // pendentes()
    const [hojeStr] = params;
    return { rows: st.campanhas.filter(c =>
      !c.legacy_kind && c.end_date && c.end_date < hojeStr &&
      !st.resultados.some(r => r.campaign_id === c.id)) };
  }
  if (text.includes('COUNT(*)::int AS n FROM campaign_results')) {
    return { rows: [{ n: st.resultados.filter(r => r.campaign_id === params[0]).length }] };
  }
  if (text.includes('DELETE FROM campaign_results')) {
    st.resultados = st.resultados.filter(r => r.campaign_id !== params[0]);
    return { rows: [] };
  }
  if (text.includes('INSERT INTO campaign_results')) {
    const [campaign_id, position, vendor_id, vendor_name, team, contracts, total_value, prize_value, spins] = params;
    st.resultados.push({ campaign_id, position, vendor_id, vendor_name, team, contracts, total_value, prize_value, spins });
    return { rows: [] };
  }
  if (text.includes('UPDATE campaigns')) {
    // Dois UPDATEs diferentes: o do congelamento (grava diagnóstico) e o de
    // marcarConcluida (só encerra). Tratar como um só escondia o segundo.
    if (text.includes('frozen_diagnostics')) {
      const c = st.campanhas.find(x => x.id === params[1]);
      if (c) { c.status = 'closed'; c.frozen_diagnostics = JSON.parse(params[0]); }
      return { rows: [], rowCount: c ? 1 : 0 };
    }
    const c = st.campanhas.find(x => x.id === params[0]);
    const mudou = Boolean(c) && c.status !== 'closed';
    if (mudou) c.status = 'closed';
    return { rows: [], rowCount: mudou ? 1 : 0 };
  }
  if (text.includes('FROM campaign_results')) {                 // lerCongelado
    return { rows: st.resultados.filter(r => r.campaign_id === params[0]).sort((a, b) => a.position - b.position) };
  }
  if (text.includes('ranking_exclusions')) return { rows: [] };
  if (text.includes('FROM users')) return { rows: [] };
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text.trim())) return { rows: [] };
  throw new Error(`query não prevista: ${text.slice(0, 60)}`);
}

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

stub('config/db', {
  query: executar,
  pool: { connect: async () => ({ query: executar, release: () => {} }) },
});
stub('services/externalApi', {
  getProposalsV3: async () => {
    st.chamadasApi++;
    if (st.erroPropostas) throw new Error(st.erroPropostas);
    if (st.falharNaChamada === st.chamadasApi) throw new Error('falha isolada');
    return st.propostas;
  },
});
stub('services/franquiaSellers', {
  getSellerIdsPorFranquia: async () => st.sellers,
  getRoboSellerIds: async () => st.robos,
});

const { congelarPendentes, congelarCampanha, marcarConcluida, lerCongelado, pendentes } =
  require(path.join(SRC, 'services', 'campaignFreezer'));

// ── Fixtures ────────────────────────────────────────────────────────────────
function campanha(over = {}) {
  return {
    id: 1, name: 'Missão Resgate',
    start_date: DIA, end_date: DIA,
    product_ids: ['13'], require_same_day: true, franquia_ids: ['matriz'],
    ladder: [{ at: 5, prize: 20 }, { at: 10, prize: 20 }],
    ladder_step: { every: 5, prize: 20 }, spin_every: 5,
    status: 'active', legacy_kind: null,
    ...over,
  };
}

function proposta(vendedor, valor, over = {}) {
  return {
    vendedor_id: vendedor, vendedor_nome: `V${vendedor}`, equipe_nome: 'GARRA',
    proposta: { valor_referencia: String(valor), produto_id: '13' },
    datas: { pagamento: DIA, cadastro: DIA },
    api: { status_api: 'PAGO' },
    ...over,
  };
}

function reset(over = {}) {
  st.campanhas = [campanha(over)];
  st.resultados = [];
  st.sellers = new Set(['10', '11']);
  st.robos = new Set();
  st.erroPropostas = null;
  st.chamadasApi = 0;
  st.falharNaChamada = null;
  st.sql = [];
  st.propostas = {
    a: proposta('10', 1000), b: proposta('10', 2000), c: proposta('11', 500),
  };
}

// ── Testes ──────────────────────────────────────────────────────────────────

test('pendentes: só campanha cujo dia já passou e ainda sem snapshot', async () => {
  reset();
  st.campanhas = [
    campanha({ id: 1, end_date: DIA }),                       // passado → entra
    campanha({ id: 2, end_date: hoje() }),                    // hoje → não
    campanha({ id: 3, end_date: '2030-01-01' }),              // futuro → não
    campanha({ id: 4, end_date: DIA, legacy_kind: 'team_scoring' }),  // legada → não
    campanha({ id: 5, end_date: null }),                      // sem data → não
  ];
  assert.deepEqual((await pendentes()).map(c => c.id), [1]);

  st.resultados = [{ campaign_id: 1, position: 1 }];
  assert.deepEqual((await pendentes()).map(c => c.id), [], 'já congelada sai da fila');
});

test('congela: grava o placar, marca closed e guarda o diagnóstico', async () => {
  reset();
  const r = await congelarCampanha(st.campanhas[0]);

  assert.equal(r.status, 'congelada');
  assert.equal(r.date, DIA);

  assert.deepEqual(st.resultados.map(x => [x.position, x.vendor_id, x.contracts, x.total_value, x.spins]), [
    [1, '10', 2, 3000, 0],
    [2, '11', 1, 500, 0],
  ]);
  assert.equal(st.resultados[0].team, 'GARRA', 'a equipe precisa ir junto');

  assert.equal(st.campanhas[0].status, 'closed');
  assert.equal(st.campanhas[0].frozen_diagnostics.paid_today, 3);

  assert.ok(st.sql.includes('BEGIN') && st.sql.includes('COMMIT'), 'gravação em transação');
});

test('o que foi congelado é o que o telão lê de volta', async () => {
  reset();
  const r = await congelarCampanha(st.campanhas[0]);
  const lido = await lerCongelado(st.campanhas[0]);

  assert.deepEqual(
    lido.board.map(v => [v.position, v.vendor_id, v.contracts, v.total_value, v.spins, v.next_at, v.missing]),
    r.board.map(v => [v.position, v.vendor_id, v.contracts, v.total_value, v.spins, v.next_at, v.missing]),
    'o placar lido tem que bater com o que foi calculado na hora de congelar'
  );
  assert.deepEqual(lido.totals, r.totals);
});

test('congelar é operação única — segunda passada não mexe', async () => {
  reset();
  await congelarCampanha(st.campanhas[0]);
  const antes = JSON.stringify(st.resultados);

  st.propostas.d = proposta('11', 99999);   // pagamento que entrou depois da virada
  const r = await congelarCampanha(st.campanhas[0]);

  assert.equal(r.status, 'ja_congelada');
  assert.equal(JSON.stringify(st.resultados), antes, 'o número congelado não pode mudar sozinho');
});

test('force recongela com os dados novos', async () => {
  reset();
  await congelarCampanha(st.campanhas[0]);
  st.propostas.d = proposta('11', 4000);

  const r = await congelarCampanha(st.campanhas[0], { force: true });
  assert.equal(r.status, 'recongelada');
  // empate em contratos desempata por valor: 11 (4500) passa 10 (3000)
  assert.deepEqual(st.resultados.map(x => [x.vendor_id, x.contracts, x.total_value]), [
    ['11', 2, 4500],
    ['10', 2, 3000],
  ]);
});

test('leitura suspeita da API não vira snapshot', async () => {
  reset();
  st.propostas = {};   // nenhum pago no dia inteiro da empresa

  const r = await congelarCampanha(st.campanhas[0]);
  assert.equal(r.status, 'adiado');
  assert.equal(st.resultados.length, 0, 'nada pode ser gravado');
  assert.equal(st.campanhas[0].status, 'active', 'e a campanha não pode ser encerrada');
});

test('erro na API não grava nada e deixa para a próxima passada', async () => {
  reset();
  st.erroPropostas = 'NC v3: 429';

  const [r] = await congelarPendentes();
  assert.equal(r.status, 'erro');
  assert.equal(st.resultados.length, 0, 'nada pode ser gravado a partir de leitura que falhou');

  // próxima passada, API de volta
  st.erroPropostas = null;
  const [ok] = await congelarPendentes();
  assert.equal(ok.status, 'congelada');
  assert.equal(st.resultados.length, 2);
});

test('data encerrada marca como concluída mesmo sem conseguir congelar', async () => {
  reset();
  st.erroPropostas = 'NC v3: 429';

  await congelarPendentes();

  // "a campanha acabou" é fato do calendário; "o resultado foi salvo" não é
  assert.equal(st.campanhas[0].status, 'closed', 'a data passou — tem que ficar concluída');
  assert.equal(st.resultados.length, 0, 'mas sem snapshot, porque a leitura falhou');
});

test('leitura suspeita também encerra, e continua na fila para tentar de novo', async () => {
  reset();
  st.propostas = {};   // nenhum pago no dia inteiro

  await congelarPendentes();
  assert.equal(st.campanhas[0].status, 'closed');
  assert.equal(st.resultados.length, 0);

  // pendentes() filtra por ausência de resultado, não por status — segue na fila
  assert.deepEqual((await pendentes()).map(c => c.id), [1]);

  reset({ status: 'closed' });   // já encerrada, ainda sem snapshot
  const [r] = await congelarPendentes();
  assert.equal(r.status, 'congelada', 'campanha já fechada ainda pode ser congelada depois');
  assert.equal(st.resultados.length, 2);
});

test('marcarConcluida não reescreve quem já está fechada', async () => {
  reset({ status: 'closed' });
  st.sql = [];
  const mudou = await marcarConcluida(st.campanhas[0]);
  assert.equal(mudou, false);
  assert.ok(!st.sql.some(q => q.startsWith('UPDATE campaigns')), 'nem chega a bater no banco');
});

test('falha de uma campanha não impede as outras', async () => {
  reset();
  st.campanhas = [campanha({ id: 1 }), campanha({ id: 2, name: 'Outra' })];

  st.falharNaChamada = 1;   // a primeira campanha da fila quebra

  const rs = await congelarPendentes();
  assert.deepEqual(rs.map(r => r.status), ['erro', 'congelada']);
  assert.ok(st.resultados.every(r => r.campaign_id === 2));
});
