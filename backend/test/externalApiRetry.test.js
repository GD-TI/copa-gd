const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

/**
 * Retry de token no ranking.php — o caminho que travou "Digitados do Dia" em
 * 13/08/2026.
 *
 * `getRankingPeriodo` e `getRankingByPayment` deduplicam chamadas em voo por
 * `_inflight`. Enquanto o retry de token recursava na função PÚBLICA, a
 * recursão caía no próprio dedup e recebia de volta a promise que estava
 * esperando por ela: a promise passava a depender de si mesma. Com o `.catch`
 * encadeado o ciclo tem comprimento 2 e o V8 não detecta (com `.then` sozinho
 * ele lançaria `Chaining cycle detected`) — nada lançava, o `.finally` nunca
 * rodava e a chave ficava presa no `_inflight` para sempre. Toda requisição
 * seguinte daquela janela pendurava sem abrir conexão nenhuma, até o processo
 * ser reiniciado.
 *
 * Estes testes falham por ESTOURO DE PRAZO se a regressão voltar — é a forma do
 * bug: ele não lança, ele emudece.
 */

// ── estado que cada teste ajusta ────────────────────────────────────────────
const st = {
  chamadas: 0,
  responder: () => ({ result: {} }),   // (n) => corpo da resposta; pode lançar
};

// O transporte é a única coisa stubada: o retry vive no externalApi.
const axiosPath = require.resolve('axios', { paths: [path.join(__dirname, '..')] });
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true, children: [], paths: [],
  exports: {
    async post() { return { data: { token: 'tok-de-teste' } }; },   // login v2
    async get(url) {
      if (!url.includes('ranking.php')) throw new Error(`URL não prevista: ${url}`);
      st.chamadas++;
      return { data: st.responder(st.chamadas) };
    },
  },
};

process.env.NEWCORBAN_USERNAME = 'usuario-de-teste';
process.env.NEWCORBAN_PASSWORD = 'senha-de-teste';

const ext = require(path.join(SRC, 'services', 'externalApi'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Falha com mensagem legível em vez de pendurar o runner até o prazo global. */
function comPrazo(promise, ms, oQue) {
  let t;
  const estouro = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(
      `${oQue}: não assentou em ${ms}ms — a promise está esperando por si mesma ` +
      `(chave presa em _inflight)`
    )), ms);
  });
  return Promise.race([promise, estouro]).finally(() => clearTimeout(t));
}

// Cada teste usa datas próprias: o cache do módulo é global e vive entre testes.
let seq = 0;
const dataUnica = () => `2020-01-${String(++seq).padStart(2, '0')}`;

test('getRankingPeriodo: erro de token no corpo (200) retenta e assenta', async () => {
  st.chamadas = 0;
  st.responder = n => (n === 1
    ? { message: 'Token mismatch' }                       // o ranking.php responde 200 com isto
    : { result: { ana: { filter_value: '7', qtd_propostas: '3' } } });

  const d = dataUnica();
  const data = await comPrazo(
    ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }),
    3000, 'getRankingPeriodo com erro de token no corpo'
  );

  assert.equal(st.chamadas, 2, 'deveria ter retentado exatamente uma vez');
  assert.ok(data.result.ana, 'deveria devolver o payload da segunda tentativa');
});

test('getRankingPeriodo: a chave não fica presa — a chamada seguinte também responde', async () => {
  st.chamadas = 0;
  st.responder = n => (n === 1
    ? { message: 'Token mismatch' }
    : { result: { bruno: { filter_value: '9', qtd_propostas: '1' } } });

  const d = dataUnica();
  // ttlMs mínimo + espera: a segunda chamada não pode ser servida pelo cache,
  // senão o teste passaria mesmo com a chave presa no _inflight.
  await comPrazo(ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }), 3000, '1ª chamada');
  await sleep(10);

  const segunda = await comPrazo(
    ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }),
    3000, '2ª chamada na MESMA chave (é o que o usuário via pendurar)'
  );

  assert.ok(segunda.result.bruno, 'a segunda chamada deveria responder normalmente');
  assert.equal(st.chamadas, 3, '1 falha de token + 1 retry + 1 chamada nova');
});

test('getRankingPeriodo: erro de token que insiste rejeita, não pendura', async () => {
  st.chamadas = 0;
  st.responder = () => ({ message: 'Token mismatch' });   // nunca melhora

  const d = dataUnica();
  await assert.rejects(
    () => comPrazo(ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }), 3000, 'token sempre inválido'),
    /Falha ao buscar ranking cadastro/,
    'deveria propagar o erro depois de esgotar o retry'
  );
  assert.equal(st.chamadas, 2, 'uma tentativa e um retry, sem laço infinito');
});

test('getRankingPeriodo: erro de token lançado pelo transporte também retenta', async () => {
  st.chamadas = 0;
  st.responder = n => {
    if (n === 1) throw new Error('Unauthenticated.');      // cai no catch, não no corpo
    return { result: { carla: { filter_value: '4', qtd_propostas: '2' } } };
  };

  const d = dataUnica();
  const data = await comPrazo(
    ext.getRankingPeriodo(d, d, 'pagamento', { ttlMs: 1 }),
    3000, 'getRankingPeriodo com erro de token no transporte'
  );

  assert.equal(st.chamadas, 2);
  assert.ok(data.result.carla);
});

test('getRankingByPayment: erro de token retenta e assenta', async () => {
  st.chamadas = 0;
  st.responder = n => (n === 1
    ? { error: 'token inválido' }
    : { result: { diego: { filter_value: '5', valor_referencia: '1000' } } });

  const d = dataUnica();
  const data = await comPrazo(
    ext.getRankingByPayment(d, d, [], []),
    3000, 'getRankingByPayment com erro de token'
  );

  assert.equal(st.chamadas, 2, 'deveria ter retentado exatamente uma vez');
  assert.ok(data.result.diego);
});

test('sem erro de token: uma única chamada, e o dedup continua valendo', async () => {
  st.chamadas = 0;
  st.responder = () => ({ result: { eva: { filter_value: '1', qtd_propostas: '9' } } });

  const d = dataUnica();
  // Duas chamadas concorrentes na mesma chave devem compartilhar uma só ida à API.
  const [a, b] = await comPrazo(
    Promise.all([
      ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }),
      ext.getRankingPeriodo(d, d, 'cadastro', { ttlMs: 1 }),
    ]),
    3000, 'duas chamadas concorrentes'
  );

  assert.equal(st.chamadas, 1, 'o dedup por _inflight deveria ter economizado a segunda ida');
  assert.ok(a.result.eva);
  assert.strictEqual(a, b, 'as duas deveriam receber exatamente o mesmo objeto');
});
