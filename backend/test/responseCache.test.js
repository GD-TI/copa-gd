const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { responseCache, invalidateResponseCache } = require('../src/middleware/responseCache');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Sobe um app real e devolve { url, close } — o middleware depende de originalUrl. */
async function subir(build) {
  const app = express();
  build(app);
  const server = await new Promise(res => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => server.close(r)),
  };
}

async function pegar(url) {
  const res = await fetch(url);
  return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
}

test('serve do cache na segunda chamada, com o mesmo corpo', async () => {
  invalidateResponseCache();
  let chamadas = 0;
  const app = await subir(a => {
    a.get('/api/x', responseCache(60_000), (req, res) => {
      chamadas++;
      res.json({ n: chamadas });
    });
  });

  const um = await pegar(`${app.url}/api/x`);
  const dois = await pegar(`${app.url}/api/x`);

  assert.equal(um.cache, 'MISS');
  assert.equal(dois.cache, 'HIT');
  assert.deepEqual(dois.body, um.body);
  assert.equal(chamadas, 1, 'handler deve rodar uma vez só');
  await app.close();
});

test('entrada expira e o handler roda de novo', async () => {
  invalidateResponseCache();
  let chamadas = 0;
  const app = await subir(a => {
    a.get('/api/x', responseCache(40), (req, res) => { chamadas++; res.json({ n: chamadas }); });
  });

  await pegar(`${app.url}/api/x`);
  await sleep(70);
  const depois = await pegar(`${app.url}/api/x`);

  assert.equal(depois.cache, 'MISS');
  assert.equal(depois.body.n, 2);
  await app.close();
});

test('query string diferente não compartilha entrada', async () => {
  invalidateResponseCache();
  const app = await subir(a => {
    a.get('/api/campaigns/1/board', responseCache(60_000), (req, res) => {
      res.json({ date: req.query.date || 'padrao' });
    });
  });

  const a1 = await pegar(`${app.url}/api/campaigns/1/board?date=2026-08-10`);
  const a2 = await pegar(`${app.url}/api/campaigns/1/board?date=2026-08-05`);
  const a3 = await pegar(`${app.url}/api/campaigns/1/board?date=2026-08-10`);

  assert.equal(a1.body.date, '2026-08-10');
  assert.equal(a2.body.date, '2026-08-05', 'o dia 05 não pode receber o cache do dia 10');
  assert.equal(a2.cache, 'MISS');
  assert.equal(a3.cache, 'HIT');
  await app.close();
});

test('res.locals.cacheTtlMs manda no TTL da entrada', async () => {
  invalidateResponseCache();
  let chamadas = 0;
  const app = await subir(a => {
    // TTL padrão altíssimo; a rota rebaixa para 40ms
    a.get('/api/x', responseCache(60_000), (req, res) => {
      chamadas++;
      res.locals.cacheTtlMs = 40;
      res.json({ n: chamadas });
    });
  });

  await pegar(`${app.url}/api/x`);
  assert.equal((await pegar(`${app.url}/api/x`)).cache, 'HIT');
  await sleep(70);
  assert.equal((await pegar(`${app.url}/api/x`)).cache, 'MISS', 'o TTL da rota deve valer');
  await app.close();
});

test('invalidação por prefixo poupa o que não casa', async () => {
  invalidateResponseCache();
  const app = await subir(a => {
    a.get('/api/scores/leaderboard', responseCache(60_000), (req, res) => res.json({ v: 1 }));
    a.get('/api/campaigns/1/board', responseCache(60_000), (req, res) => res.json({ v: 1 }));
  });

  await pegar(`${app.url}/api/scores/leaderboard`);
  await pegar(`${app.url}/api/campaigns/1/board`);

  invalidateResponseCache(['/api/scores']);

  assert.equal((await pegar(`${app.url}/api/scores/leaderboard`)).cache, 'MISS', 'scores deve cair');
  assert.equal((await pegar(`${app.url}/api/campaigns/1/board`)).cache, 'HIT', 'placar deve sobreviver');
  await app.close();
});

test('invalidação sem argumento continua limpando tudo', async () => {
  invalidateResponseCache();
  const app = await subir(a => {
    a.get('/api/scores/leaderboard', responseCache(60_000), (req, res) => res.json({ v: 1 }));
    a.get('/api/campaigns/1/board', responseCache(60_000), (req, res) => res.json({ v: 1 }));
  });

  await pegar(`${app.url}/api/scores/leaderboard`);
  await pegar(`${app.url}/api/campaigns/1/board`);
  invalidateResponseCache();

  assert.equal((await pegar(`${app.url}/api/scores/leaderboard`)).cache, 'MISS');
  assert.equal((await pegar(`${app.url}/api/campaigns/1/board`)).cache, 'MISS');
  await app.close();
});

test('resultado vazio e resposta de erro não entram no cache', async () => {
  invalidateResponseCache();
  const app = await subir(a => {
    a.get('/api/vazio', responseCache(60_000), (req, res) => res.json([]));
    a.get('/api/erro', responseCache(60_000), (req, res) => res.status(502).json({ error: 'x' }));
  });

  await pegar(`${app.url}/api/vazio`);
  await pegar(`${app.url}/api/erro`);

  assert.equal((await pegar(`${app.url}/api/vazio`)).cache, 'MISS');
  assert.equal((await pegar(`${app.url}/api/erro`)).cache, 'MISS');
  await app.close();
});
