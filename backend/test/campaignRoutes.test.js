const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const SRC = path.join(__dirname, '..', 'src');
process.env.JWT_SECRET = 'segredo-de-teste';

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

const st = {
  campanhas: [],
  queries: [],
  inserida: null,
  atualizada: null,
  placares: 0,
};

// ── Stubs ───────────────────────────────────────────────────────────────────
stub('config/db', {
  query: async (sql, params = []) => {
    st.queries.push({ sql, params });

    if (/FROM campaigns\s+ORDER BY/is.test(sql)) return { rows: st.campanhas };

    if (/SELECT \* FROM campaigns WHERE id/i.test(sql)) {
      const c = st.campanhas.find(x => String(x.id) === String(params[0]));
      return { rows: c ? [c] : [] };
    }

    if (/^INSERT INTO campaigns/i.test(sql.trim())) {
      const row = {
        id: 99, name: params[0], status: 'draft',
        franquia_ids: params[8], owner_franquia_id: params[9],
      };
      st.inserida = { params, row };
      return { rows: [row] };
    }

    if (/^UPDATE campaigns SET/i.test(sql.trim())) {
      st.atualizada = { sql, params };
      const c = st.campanhas.find(x => String(x.id) === String(params[params.length - 1]));
      return { rows: [{ ...(c || { id: params[params.length - 1] }) }] };
    }

    return { rows: [] };
  },
  pool: { connect: async () => { throw new Error('transação não usada neste teste'); } },
});

// O escopo real vem do banco e do cadastro do NewCorban; aqui é fixo por usuário.
const ESCOPOS = { 1: null, 2: ['6'], 3: ['7'], 4: [], 5: ['6'] };
stub('services/franquiaScopes', {
  resolverEscopoDeFranquia: async user => ESCOPOS[user.id] ?? [],
});

// Real, menos o cálculo: pgDateStr/diaDoPlacar/todayBR são usados pelas rotas e
// duplicá-los no stub criaria divergência com o código de produção.
const boardReal = require(path.join(SRC, 'services', 'campaignBoard'));
stub('services/campaignBoard', {
  ...boardReal,
  montarPlacar: async () => {
    st.placares += 1;
    return {
      board: [{ position: 1, vendor_id: '10', vendor_name: 'FULANO', contracts: 3 }],
      totals: { contracts: 3, value: 300, participants: 1 },
      diagnostics: { paid_today: 9 },
    };
  },
});

stub('services/campaignFreezer', {
  congelarCampanha: async () => ({ status: 'congelada' }),
  lerCongelado: async () => null,
});
stub('routes/groups', { fetchGroupsRanking: async () => ({ groups: [] }) });
stub('routes/scores', { fetchIndividualRankings: async () => ({}) });

const campaigns = require(path.join(SRC, 'routes', 'campaigns'));
const { invalidateResponseCache } = require(path.join(SRC, 'middleware', 'responseCache'));

const app = express();
app.use(express.json());
app.use('/api/campaigns', campaigns);

let server, base;
test.before(async () => {
  server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server?.close());

// ── Personagens ─────────────────────────────────────────────────────────────
const USUARIOS = {
  matriz:     { id: 1, username: 'admin',         role: 'admin' },
  tatuape:    { id: 2, username: 'dono.tatuape',  role: 'franqueado' },
  guarulhos:  { id: 3, username: 'dono.guarulhos', role: 'franqueado' },
  semVinculo: { id: 4, username: 'dono.novo',     role: 'franqueado' },
  consultor:  { id: 5, username: 'joao',          role: 'player' },
};
const token = quem => jwt.sign(USUARIOS[quem], process.env.JWT_SECRET, { expiresIn: '1h' });

async function chamar(quem, rota, { method = 'GET', body } = {}) {
  const r = await fetch(base + rota, {
    method,
    headers: {
      Authorization: `Bearer ${token(quem)}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test.beforeEach(() => {
  invalidateResponseCache();
  st.queries = [];
  st.inserida = null;
  st.atualizada = null;
  st.placares = 0;
  st.campanhas = [
    { id: 10, name: 'Tatuapé Agosto',  status: 'active', owner_franquia_id: '6', franquia_ids: ['6'] },
    { id: 20, name: 'Guarulhos Agosto', status: 'active', owner_franquia_id: '7', franquia_ids: ['7'] },
    { id: 30, name: 'Matriz p/ 6 e 7', status: 'active', owner_franquia_id: null, franquia_ids: ['6', '7'] },
    { id: 40, name: 'Empresa inteira',  status: 'active', owner_franquia_id: null, franquia_ids: null },
    { id: 50, name: 'Rascunho matriz',  status: 'draft',  owner_franquia_id: null, franquia_ids: ['6'] },
  ];
});

const ids = body => body.map(c => c.id).sort((a, b) => a - b);

// ── Listagem ────────────────────────────────────────────────────────────────

test('sem token é 401', async () => {
  const r = await fetch(base + '/api/campaigns');
  assert.equal(r.status, 401);
});

test('a matriz lista todas', async () => {
  const { status, body } = await chamar('matriz', '/api/campaigns');
  assert.equal(status, 200);
  assert.deepEqual(ids(body), [10, 20, 30, 40, 50]);
});

test('franqueado não recebe a campanha da outra franquia', async () => {
  const { body } = await chamar('tatuape', '/api/campaigns');
  assert.deepEqual(ids(body), [10, 30, 40, 50]);
  assert.ok(!body.some(c => c.id === 20), 'Guarulhos não pode aparecer para o Tatuapé');
});

test('a lista já diz o que cada um pode editar', async () => {
  const { body } = await chamar('tatuape', '/api/campaigns');
  assert.equal(body.find(c => c.id === 10).pode_editar, true,  'a própria');
  assert.equal(body.find(c => c.id === 30).pode_editar, false, 'a da matriz');
});

test('consultor não vê rascunho nem campanha de outra franquia', async () => {
  const { body } = await chamar('consultor', '/api/campaigns');
  assert.deepEqual(ids(body), [10, 30, 40]);
});

// ── Placar ──────────────────────────────────────────────────────────────────

test('franqueado abre o placar da própria campanha', async () => {
  const { status, body } = await chamar('tatuape', '/api/campaigns/10/board');
  assert.equal(status, 200);
  assert.equal(body.board[0].vendor_name, 'FULANO');
});

test('placar de campanha de outra franquia é 403, mesmo sabendo o id', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns/20/board');
  assert.equal(status, 403);
  assert.equal(st.placares, 0, 'não pode nem calcular o placar alheio');
});

test('o cache do placar não fura a permissão', async () => {
  // A checagem é middleware ANTES do responseCache de propósito: dentro do
  // handler ela seria pulada toda vez que a resposta viesse do cache.
  const primeiro = await chamar('matriz', '/api/campaigns/20/board');
  assert.equal(primeiro.status, 200);
  assert.equal(st.placares, 1);

  const segundo = await chamar('tatuape', '/api/campaigns/20/board');
  assert.equal(segundo.status, 403, 'a resposta cacheada não pode vazar para outra franquia');
});

test('campanha inexistente é 404', async () => {
  const { status } = await chamar('matriz', '/api/campaigns/777');
  assert.equal(status, 404);
});

// ── Criação ─────────────────────────────────────────────────────────────────

test('franqueado cria com o próprio escopo, ignorando o que mandou no corpo', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns', {
    method: 'POST',
    body: { name: 'Minha campanha', franquia_ids: ['7', 'matriz'] },
  });
  assert.equal(status, 201);
  assert.deepEqual(st.inserida.row.franquia_ids, ['6'], 'abrangência veio do escopo, não do corpo');
  assert.equal(st.inserida.row.owner_franquia_id, '6');
});

test('a matriz cria para várias franquias', async () => {
  await chamar('matriz', '/api/campaigns', {
    method: 'POST',
    body: { name: 'Campanha geral', franquia_ids: ['6', '7', 'matriz'] },
  });
  assert.deepEqual(st.inserida.row.franquia_ids, ['6', '7', 'matriz']);
  assert.equal(st.inserida.row.owner_franquia_id, null, 'campanha da matriz não tem franquia dona');
});

test('a matriz sem escolher franquia cria para a empresa inteira', async () => {
  await chamar('matriz', '/api/campaigns', { method: 'POST', body: { name: 'Todos' } });
  assert.equal(st.inserida.row.franquia_ids, null);
});

test('dono sem vínculo recebe 400 explicativo em vez de criar campanha global', async () => {
  const { status, body } = await chamar('semVinculo', '/api/campaigns', {
    method: 'POST', body: { name: 'Tentativa' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /não está vinculada/i);
  assert.equal(st.inserida, null, 'nada pode ter sido gravado');
});

test('consultor não cria campanha', async () => {
  const { status } = await chamar('consultor', '/api/campaigns', {
    method: 'POST', body: { name: 'Minha' },
  });
  assert.equal(status, 403);
  assert.equal(st.inserida, null);
});

test('nome é obrigatório', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns', { method: 'POST', body: { name: '  ' } });
  assert.equal(status, 400);
});

// ── Edição ──────────────────────────────────────────────────────────────────

test('franqueado edita a própria campanha', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns/10', {
    method: 'PUT', body: { name: 'Novo nome' },
  });
  assert.equal(status, 200);
  assert.match(st.atualizada.sql, /name = \$1/);
});

test('franqueado não edita campanha da matriz que ele apenas participa', async () => {
  const { status, body } = await chamar('tatuape', '/api/campaigns/30', {
    method: 'PUT', body: { name: 'Sequestrada' },
  });
  assert.equal(status, 403);
  assert.match(body.error, /matriz/i);
  assert.equal(st.atualizada, null);
});

test('franqueado não consegue mudar a abrangência pelo PUT', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns/10', {
    method: 'PUT', body: { name: 'ok', franquia_ids: ['6', '7', 'matriz'] },
  });
  assert.equal(status, 200);
  assert.ok(!/franquia_ids/.test(st.atualizada.sql), 'franquia_ids não pode entrar no UPDATE');
  assert.ok(!st.atualizada.params.some(p => Array.isArray(p) && p.includes('matriz')));
});

test('a matriz muda a abrangência normalmente', async () => {
  const { status } = await chamar('matriz', '/api/campaigns/10', {
    method: 'PUT', body: { franquia_ids: ['6', '7'] },
  });
  assert.equal(status, 200);
  assert.match(st.atualizada.sql, /franquia_ids = \$1/);
});

test('PUT sem nenhum campo conhecido é 400', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns/10', {
    method: 'PUT', body: { franquia_ids: ['7'] },   // único campo, e ele é bloqueado
  });
  assert.equal(status, 400);
});

test('franqueado não congela placar — congelar é da matriz', async () => {
  const { status } = await chamar('tatuape', '/api/campaigns/10/freeze', { method: 'POST' });
  assert.equal(status, 403);
});
