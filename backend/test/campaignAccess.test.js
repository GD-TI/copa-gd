const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  ErroDeEscopo, contexto, podeVer, abrangenciaParaCriacao,
  donoDaCampanha, podeEditar, camposEditaveis,
} = require(path.join(__dirname, '..', 'src', 'services', 'campaignAccess'));

// ── Personagens ─────────────────────────────────────────────────────────────
const matriz      = () => contexto({ role: 'admin' }, null);
const tatuape     = () => contexto({ role: 'franqueado' }, ['6']);
const guarulhos   = () => contexto({ role: 'franqueado' }, ['7']);
const semVinculo  = () => contexto({ role: 'franqueado' }, []);
const doisDonos   = () => contexto({ role: 'franqueado' }, ['6', '7']);
const consultor6  = () => contexto({ role: 'player' }, ['6']);
const consultorSemFranquia = () => contexto({ role: 'player' }, []);

// ── Campanhas ───────────────────────────────────────────────────────────────
const daFranquia = (fid, extra = {}) => ({
  id: 1, status: 'active', owner_franquia_id: fid, franquia_ids: [fid], ...extra,
});
const daMatrizPara = (fids, extra = {}) => ({
  id: 2, status: 'active', owner_franquia_id: null, franquia_ids: fids, ...extra,
});
const daEmpresaInteira = (extra = {}) => daMatrizPara(null, extra);

// ── Visibilidade ────────────────────────────────────────────────────────────

test('a matriz vê tudo, inclusive rascunho de franquia', () => {
  assert.equal(podeVer(matriz(), daFranquia('6', { status: 'draft' })), true);
  assert.equal(podeVer(matriz(), daEmpresaInteira()), true);
});

test('franqueado não vê campanha de outra franquia', () => {
  assert.equal(podeVer(tatuape(), daFranquia('7')), false);
  assert.equal(podeVer(guarulhos(), daFranquia('6')), false);
});

test('franqueado vê a própria campanha, mesmo em rascunho', () => {
  assert.equal(podeVer(tatuape(), daFranquia('6', { status: 'draft' })), true);
});

test('franqueado vê a campanha que a matriz criou incluindo a franquia dele', () => {
  assert.equal(podeVer(tatuape(), daMatrizPara(['6', '7'])), true);
  assert.equal(podeVer(tatuape(), daMatrizPara(['7'])), false);
  assert.equal(podeVer(tatuape(), daEmpresaInteira()), true);
});

test('rascunho da matriz aparece para o franqueado — ele precisa conferir antes de valer', () => {
  assert.equal(podeVer(tatuape(), daMatrizPara(['6'], { status: 'draft' })), true);
});

test('dono de duas franquias vê as duas', () => {
  assert.equal(podeVer(doisDonos(), daFranquia('6')), true);
  assert.equal(podeVer(doisDonos(), daFranquia('7')), true);
  assert.equal(podeVer(doisDonos(), daFranquia('24')), false);
});

test('consultor não vê rascunho, nem campanha de outra franquia', () => {
  assert.equal(podeVer(consultor6(), daMatrizPara(['6'], { status: 'draft' })), false);
  assert.equal(podeVer(consultor6(), daMatrizPara(['6'])), true);
  assert.equal(podeVer(consultor6(), daFranquia('7')), false);
  assert.equal(podeVer(consultor6(), daEmpresaInteira()), true);
});

test('consultor sem franquia conhecida (cadastro NewCorban fora do ar) só vê campanha da empresa inteira', () => {
  // Degradação conservadora: esconder demais é melhor que vazar campanha alheia
  assert.equal(podeVer(consultorSemFranquia(), daEmpresaInteira()), true);
  assert.equal(podeVer(consultorSemFranquia(), daMatrizPara(['6'])), false);
});

test('franquia_ids vazio é tratado como empresa inteira, igual a NULL', () => {
  assert.equal(podeVer(consultor6(), daMatrizPara([])), true);
});

test('campanha inexistente nunca é visível para quem não é master', () => {
  assert.equal(podeVer(tatuape(), null), false);
  assert.equal(podeVer(consultor6(), undefined), false);
});

// ── Abrangência na criação ──────────────────────────────────────────────────

test('a matriz escolhe as franquias livremente', () => {
  assert.deepEqual(abrangenciaParaCriacao(matriz(), ['6', '7']), ['6', '7']);
});

test('a matriz sem escolher nenhuma cria campanha da empresa inteira', () => {
  assert.equal(abrangenciaParaCriacao(matriz(), []), null);
  assert.equal(abrangenciaParaCriacao(matriz(), undefined), null);
});

test('a matriz tem a lista normalizada — sem espaços, vazios nem repetidos', () => {
  assert.deepEqual(abrangenciaParaCriacao(matriz(), [' 6 ', '6', '', '7']), ['6', '7']);
});

test('franqueado recebe o próprio escopo e o pedido do corpo é IGNORADO', () => {
  // É isto que faz "só a matriz cria para todas" ser regra de API, não de tela
  assert.deepEqual(abrangenciaParaCriacao(tatuape(), ['7', 'matriz']), ['6']);
  assert.deepEqual(abrangenciaParaCriacao(tatuape(), []), ['6']);
  assert.deepEqual(abrangenciaParaCriacao(doisDonos(), ['24']), ['6', '7']);
});

test('franqueado sem vínculo é RECUSADO em vez de virar campanha global', () => {
  // franquia_ids = [] significa "sem filtro" lá no placar: sem esta guarda, um
  // dono sem escopo criaria campanha da empresa inteira
  assert.throws(() => abrangenciaParaCriacao(semVinculo(), ['6']), ErroDeEscopo);
  assert.throws(() => abrangenciaParaCriacao(semVinculo(), []), /não está vinculada/i);
});

test('quem não é master nem franqueado não cria campanha', () => {
  assert.throws(() => abrangenciaParaCriacao(consultor6(), []), /Sem permissão/i);
});

test('ErroDeEscopo responde 400 — é erro de quem pediu, não do servidor', () => {
  try {
    abrangenciaParaCriacao(semVinculo(), []);
    assert.fail('devia ter lançado');
  } catch (err) {
    assert.equal(err.status, 400);
  }
});

// ── Dono da campanha ────────────────────────────────────────────────────────

test('campanha da matriz nasce sem dono; a do franqueado nasce com a franquia dele', () => {
  assert.equal(donoDaCampanha(matriz()), null);
  assert.equal(donoDaCampanha(tatuape()), '6');
  assert.equal(donoDaCampanha(doisDonos()), '6');   // com escopo múltiplo, a primeira
});

// ── Edição ──────────────────────────────────────────────────────────────────

test('franqueado edita a própria campanha', () => {
  assert.equal(podeEditar(tatuape(), daFranquia('6')), true);
});

test('franqueado NÃO edita campanha da matriz, mesmo participando dela', () => {
  assert.equal(podeVer(tatuape(), daMatrizPara(['6'])), true, 'ele vê');
  assert.equal(podeEditar(tatuape(), daMatrizPara(['6'])), false, 'mas não mexe');
});

test('franqueado não edita campanha de outra franquia', () => {
  assert.equal(podeEditar(tatuape(), daFranquia('7')), false);
});

test('consultor não edita nada', () => {
  assert.equal(podeEditar(consultor6(), daFranquia('6')), false);
  assert.equal(podeEditar(consultor6(), daEmpresaInteira()), false);
});

test('a matriz edita qualquer campanha', () => {
  assert.equal(podeEditar(matriz(), daFranquia('7')), true);
});

// ── Campos editáveis ────────────────────────────────────────────────────────

test('franquia_ids só a matriz altera — senão o PUT desfaria o travamento da criação', () => {
  assert.ok(camposEditaveis(matriz()).includes('franquia_ids'));
  assert.ok(!camposEditaveis(tatuape()).includes('franquia_ids'));
});

test('o franqueado mantém os campos operacionais da própria campanha', () => {
  const campos = camposEditaveis(tatuape());
  for (const c of ['name', 'start_date', 'end_date', 'ladder', 'spin_every', 'status']) {
    assert.ok(campos.includes(c), `faltou ${c}`);
  }
});
