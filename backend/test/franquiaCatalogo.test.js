const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

// ── Cadastro de consultores que o `equipe.php` devolveria ───────────────────
const st = { usuarios: [] };

function stub(rel, exports) {
  const r = require.resolve(path.join(SRC, rel));
  require.cache[r] = { id: r, filename: r, loaded: true, exports, children: [], paths: [] };
}

stub('services/externalApi', {
  listarEquipe: async () => st.usuarios,
});

const {
  listarFranquias,
  getSellerIdsPorFranquia,
  invalidarCacheFranquias,
} = require(path.join(SRC, 'services', 'franquiaSellers'));

function consultor(id, franquiaId, franquiaNome, extra = {}) {
  return { id, franquia_id: franquiaId, franquia_nome: franquiaNome, ...extra };
}

// Recorte do cadastro real de 19/08/2026: duas em operação, duas encerradas.
function cadastroPadrao() {
  return [
    consultor(100, null, null),                          // matriz
    consultor(101, '6', 'Franquia Tatuape'),
    consultor(102, '24', 'Franquia Gabriel Machado'),
    consultor(103, '3', 'Franquia Santo Amaro'),         // encerrada
    consultor(104, '1', 'Franquia Maua'),                // encerrada desde 2024
  ];
}

test.beforeEach(() => {
  st.usuarios = cadastroPadrao();
  invalidarCacheFranquias();
});

test('o catálogo esconde as franquias fora de operação', async () => {
  const ids = (await listarFranquias()).map(f => f.id);
  // Matriz primeiro, o resto por nome: Gabriel Machado (24), Tatuapé (6).
  assert.deepStrictEqual(ids, ['matriz', '24', '6']);
});

test('`manter` devolve a franquia encerrada a que alguém já está vinculado', async () => {
  const ids = (await listarFranquias({ manter: ['3'] })).map(f => f.id);
  assert.ok(ids.includes('3'), 'o vínculo existente vale mais que a lista');
  assert.ok(!ids.includes('1'), 'só a pedida volta, não todas');

  // Nome de verdade, não o id cru: é o que a tela mostra ao lado da caixa.
  const santoAmaro = (await listarFranquias({ manter: ['3'] })).find(f => f.id === '3');
  assert.strictEqual(santoAmaro.nome, 'Franquia Santo Amaro');
});

test('franquia nova aparece sozinha — a lista é de exclusão, não de inclusão', async () => {
  st.usuarios = [...cadastroPadrao(), consultor(105, '2026', 'Franquia Osasco')];
  invalidarCacheFranquias();

  const ids = (await listarFranquias()).map(f => f.id);
  assert.ok(ids.includes('2026'), 'catálogo derivado: unidade nova entra sem mexer no código');
});

test('esconder do formulário não muda o placar de campanha já criada', async () => {
  // `getSellerIdsPorFranquia` é o filtro do placar. Se ele respeitasse a lista,
  // uma campanha antiga apontada para Santo Amaro passaria a somar zero.
  const vendedores = await getSellerIdsPorFranquia(['3']);
  assert.deepStrictEqual([...vendedores], ['103']);
});
