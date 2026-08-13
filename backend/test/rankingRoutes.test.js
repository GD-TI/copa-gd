const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

const SRC = path.join(__dirname, '..', 'src');

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const mesAtual = () => hoje().slice(0, 7);

const st = {
  aoVivo: null,
  congelados: {},     // { '2026-06': {...} }
  listaMeses: [],
  erroMensal: null,
  erroDigitados: null,
  digitados: null,
  pedidos: [],        // o que chegou no serviço ao vivo
};

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

stub('middleware/auth', {
  authMiddleware: (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  adminOnly: (req, res, next) => next(),
});

stub('services/rankingIndividual', {
  hojeBR: hoje,
  mesAtual,
  rankingMensal: async (mes) => {
    st.pedidos.push({ tipo: 'mensal', mes });
    if (st.erroMensal) throw new Error(st.erroMensal);
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error(`Mês inválido: "${mes}"`);
    return { ...st.aoVivo, mes, ao_vivo: mes === mesAtual(), congelado: false };
  },
  digitadosDoDia: async (dia) => {
    st.pedidos.push({ tipo: 'digitados', dia });
    if (st.erroDigitados) throw new Error(st.erroDigitados);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error(`Data inválida: "${dia}"`);
    return { ...st.digitados, dia, ao_vivo: dia === hoje() };
  },
});

stub('services/monthlyFreezer', {
  lerCongelado: async (mes) => st.congelados[mes] || null,
  mesesCongelados: async () => st.listaMeses,
});

const rankings = require(path.join(SRC, 'routes', 'rankings'));
const { invalidateResponseCache } = require(path.join(SRC, 'middleware', 'responseCache'));

const app = express();
app.use('/api/rankings', rankings);
let server, base;

test.before(async () => {
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

test.beforeEach(() => {
  invalidateResponseCache();
  st.aoVivo = { board: [{ position: 1, nome: 'AO VIVO' }], totals: { participantes: 1, contratos: 5, valor: 500 }, diagnostics: {} };
  st.digitados = { board: [{ position: 1, nome: 'DIGITOU' }], totals: { participantes: 1, contratos: 3, valor: 30 }, diagnostics: {} };
  st.congelados = {};
  st.listaMeses = [];
  st.erroMensal = null;
  st.erroDigitados = null;
  st.pedidos = [];
});

const pegar = async (rota) => {
  const r = await fetch(base + rota);
  return { status: r.status, body: await r.json() };
};

// ── Mensal ──────────────────────────────────────────────────────────────────

test('sem ?mes assume o mês corrente e vai ao vivo', async () => {
  const { status, body } = await pegar('/api/rankings/mensal');
  assert.equal(status, 200);
  assert.equal(body.mes, mesAtual());
  assert.equal(body.ao_vivo, true);
  assert.deepEqual(st.pedidos, [{ tipo: 'mensal', mes: mesAtual() }]);
});

test('mês congelado vence a API — o serviço ao vivo nem é chamado', async () => {
  st.congelados['2026-06'] = {
    mes: '2026-06', congelado: true, ao_vivo: false,
    board: [{ position: 1, nome: 'CONGELADO' }],
    totals: { participantes: 1, contratos: 9, valor: 900 }, diagnostics: {},
  };

  const { body } = await pegar('/api/rankings/mensal?mes=2026-06');
  assert.equal(body.congelado, true);
  assert.equal(body.board[0].nome, 'CONGELADO');
  assert.equal(st.pedidos.length, 0, 'não pode ir à NewCorban quando existe foto');
});

test('mês passado sem foto cai no ao vivo em vez de devolver vazio', async () => {
  const { body } = await pegar('/api/rankings/mensal?mes=2026-06');
  assert.equal(body.congelado, false);
  assert.equal(body.board[0].nome, 'AO VIVO');
  assert.deepEqual(st.pedidos, [{ tipo: 'mensal', mes: '2026-06' }]);
});

test('o mês corrente nunca lê foto, mesmo se existir uma', async () => {
  const atual = mesAtual();
  st.congelados[atual] = { mes: atual, congelado: true, board: [{ nome: 'NAO DEVE APARECER' }], totals: {}, diagnostics: {} };

  const { body } = await pegar(`/api/rankings/mensal?mes=${atual}`);
  assert.equal(body.board[0].nome, 'AO VIVO');
});

test('mês malformado é 400, não 502', async () => {
  const { status, body } = await pegar('/api/rankings/mensal?mes=agosto');
  assert.equal(status, 400);
  assert.match(body.detail, /inválido/i);
});

test('NewCorban fora do ar vira 502 com o motivo', async () => {
  st.erroMensal = 'NewCorban 502 bad gateway';
  const { status, body } = await pegar('/api/rankings/mensal?mes=2026-06');
  assert.equal(status, 502);
  assert.match(body.detail, /bad gateway/);
});

// ── Digitados ───────────────────────────────────────────────────────────────

test('sem ?date assume hoje', async () => {
  const { status, body } = await pegar('/api/rankings/digitados');
  assert.equal(status, 200);
  assert.equal(body.dia, hoje());
  assert.equal(body.ao_vivo, true);
});

test('?date de outro dia é respeitado', async () => {
  const { body } = await pegar('/api/rankings/digitados?date=2026-08-10');
  assert.equal(body.dia, '2026-08-10');
  assert.equal(body.ao_vivo, false);
});

test('data malformada é 400', async () => {
  const { status } = await pegar('/api/rankings/digitados?date=10/08/2026');
  assert.equal(status, 400);
});

// ── Cache ───────────────────────────────────────────────────────────────────

test('dias diferentes não compartilham entrada de cache', async () => {
  // A chave é req.originalUrl: com req.path, ?date=A e ?date=B colidiriam e um
  // serviria o dia do outro — bug já corrigido uma vez no responseCache.
  const a = await pegar('/api/rankings/digitados?date=2026-08-10');
  const b = await pegar('/api/rankings/digitados?date=2026-08-09');
  assert.equal(a.body.dia, '2026-08-10');
  assert.equal(b.body.dia, '2026-08-09');
});

test('segunda chamada igual sai do cache sem tocar no serviço', async () => {
  await pegar('/api/rankings/mensal?mes=2026-06');
  const antes = st.pedidos.length;
  const { body } = await pegar('/api/rankings/mensal?mes=2026-06');
  assert.equal(st.pedidos.length, antes, 'a segunda chamada tinha de vir do cache');
  assert.equal(body.board[0].nome, 'AO VIVO');
});

test('erro não entra no cache — a próxima chamada tenta de novo', async () => {
  st.erroMensal = 'timeout';
  assert.equal((await pegar('/api/rankings/mensal?mes=2026-06')).status, 502);

  st.erroMensal = null;
  const { status, body } = await pegar('/api/rankings/mensal?mes=2026-06');
  assert.equal(status, 200);
  assert.equal(body.board[0].nome, 'AO VIVO');
});

// ── Lista de meses ──────────────────────────────────────────────────────────

test('lista de meses põe o corrente na frente, marcado como ao vivo', async () => {
  st.listaMeses = [
    { mes: '2026-07', participantes: 60, contratos: 3000, valor: 7000000 },
    { mes: '2026-06', participantes: 58, contratos: 2800, valor: 6500000 },
  ];

  const { body } = await pegar('/api/rankings/meses');
  assert.equal(body.atual, mesAtual());
  assert.equal(body.meses[0].mes, mesAtual());
  assert.equal(body.meses[0].ao_vivo, true);
  assert.deepEqual(body.meses.slice(1).map(m => m.mes), ['2026-07', '2026-06']);
  assert.equal(body.meses[1].congelado, true);
});

test('mês corrente não aparece duas vezes se já tiver foto', async () => {
  const atual = mesAtual();
  st.listaMeses = [{ mes: atual, participantes: 1, contratos: 1, valor: 1 }];

  const { body } = await pegar('/api/rankings/meses');
  assert.equal(body.meses.filter(m => m.mes === atual).length, 1);
  assert.equal(body.meses[0].ao_vivo, true);
});
