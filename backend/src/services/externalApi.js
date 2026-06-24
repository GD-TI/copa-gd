const axios = require("axios");

const SERVER_BASE = "https://server.newcorban.com.br/system";
const APIV2_BASE = "https://apiv2.newcorban.com.br/api/v2";

// Cache simples para evitar chamadas concorrentes à API externa
// TTL de 3 minutos — suficiente para absorver picos sem dados muito desatualizados
const _cache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Limpeza periódica de entradas expiradas (evita leak de memória — cada dia cria uma nova chave)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache.entries()) {
    if (now > v.expiresAt) _cache.delete(k);
  }
}, 10 * 60 * 1000);

// Se uma chamada para a mesma chave já está em andamento, aguarda ela ao invés de disparar outra
const _inflight = new Map();

// ---- Gerenciamento de token NewCorban v2 ----
let _token = null;
let _tokenExpiry = null;

async function getToken() {
  if (_token && _tokenExpiry && Date.now() < _tokenExpiry) {
    return _token;
  }

  const username = process.env.NEWCORBAN_USERNAME;
  const password = process.env.NEWCORBAN_PASSWORD;
  const subdomain = process.env.NEWCORBAN_SUBDOMAIN || "grupodigital";

  if (!username || !password) {
    throw new Error(
      "Credenciais NewCorban não configuradas (NEWCORBAN_USERNAME / NEWCORBAN_PASSWORD)",
    );
  }

  try {
    const { data } = await axios.post(
      `${APIV2_BASE}/auth/login`,
      { username, password, subdomain },
      { timeout: 15000 },
    );

    _token =
      data.token ||
      data.access_token ||
      data.data?.token ||
      data.data?.access_token;
    if (!_token) throw new Error("Token não encontrado na resposta de login");

    // Token expira em 23h (conservador, refresh antes do provável vencimento)
    _tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    console.log("[NewCorban] Token obtido com sucesso.");
    return _token;
  } catch (err) {
    _token = null;
    _tokenExpiry = null;
    throw new Error(
      `Falha no login NewCorban: ${err.response?.data?.message || err.message}`,
    );
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// Limpar token em cache (forçar re-login)
function clearToken() {
  _token = null;
  _tokenExpiry = null;
}

// ---- API v2: Usuários NewCorban ----

// Buscar uma página de usuários
async function getUsersPage(page = 1, perPage = 100) {
  const token = await getToken();
  try {
    const { data } = await axios.get(`${APIV2_BASE}/users`, {
      params: { page, per_page: perPage, order_by: "name", order_dir: "asc" },
      headers: authHeaders(token),
      timeout: 15000,
    });
    return data; // { success, data: [...], meta: { total, last_page, ... } }
  } catch (err) {
    if (err.response?.status === 401) {
      clearToken();
    }
    throw new Error(
      `Falha ao buscar usuários: ${err.response?.data?.message || err.message}`,
    );
  }
}

// Buscar todos os usuários (paginação automática)
async function getAllUsers() {
  const firstPage = await getUsersPage(1, 100);
  let users = firstPage.data || [];

  const total = firstPage.meta?.total || users.length;
  const lastPage = firstPage.meta?.last_page || 1;

  for (let page = 2; page <= lastPage; page++) {
    const res = await getUsersPage(page, 100);
    users = users.concat(res.data || []);
  }

  return users;
}

// Encontrar usuário pelo username (busca exata, case-insensitive)
async function findUserByUsername(username) {
  if (!username) return null;

  const lower = username.trim().toLowerCase();
  let page = 1;
  let lastPage = 1;

  do {
    const res = await getUsersPage(page, 100);
    const found = (res.data || []).find(
      (u) => u.username?.toLowerCase() === lower,
    );
    if (found) return found;

    lastPage = res.meta?.last_page || 1;
    page++;
  } while (page <= lastPage);

  return null;
}

// ---- Ranking (server.newcorban.com.br) ----

function encodeFilter(filterObj) {
  const jsonStr = JSON.stringify(filterObj);
  const urlEncoded = encodeURIComponent(jsonStr);
  return Buffer.from(urlEncoded).toString("base64");
}

function buildRankingFilter(startDate, endDate) {
  return {
    first_level: "vendedores",
    second_level: "vendedores",
    type: "agrupado",
    metrica: "qtd_propostas",
    banco: [],
    not_banco: [],
    promotora: [],
    not_promotora: [],
    status: [],
    not_status: [],
    produto: [],
    not_produto: [],
    convenio: [],
    not_convenio: [],
    equipe: [],
    not_equipe: [],
    vendedor: [],
    not_vendedor: [],
    vendedor_participante: [],
    not_vendedor_participante: [],
    tabela: [],
    not_tabela: [],
    origem: [],
    not_origem: [],
    franquia: [],
    not_franquia: [],
    ver_como_franquia: false,
    comissionado: false,
    nao_comissionado: false,
    estornado: false,
    nao_estornado: false,
    onlyDuplicadas: false,
    hideDuplicadas: false,
    hide_repassado: false,
    data: { tipo: "cadasto", startDate, endDate, intervalo: "today" },
  };
}


function isTokenError(err, data) {
  if (err?.response?.status === 401) return true;
  const msg = (err?.message || data?.message || data?.error || '').toLowerCase();
  return msg.includes('token') || msg.includes('unauthorized') || msg.includes('unauthenticated');
}

async function getRanking(startDate, endDate, _retry = true) {
  const token = await getToken();
  const filter = buildRankingFilter(startDate, endDate);
  const encodedFilter = encodeFilter(filter);

  try {
    const { data } = await axios.get(`${SERVER_BASE}/ranking.php`, {
      params: { action: "performance", i: encodedFilter },
      headers: authHeaders(token),
      timeout: 30000,
    });
    // Resposta 200 mas com erro de token no corpo (ex: "Token mismatch")
    if (data && typeof data === 'object' && isTokenError(null, data) && _retry) {
      console.warn('[NewCorban] Token inválido no ranking, renovando e retentando...');
      clearToken();
      return getRanking(startDate, endDate, false);
    }
    return data;
  } catch (err) {
    if (isTokenError(err) && _retry) {
      console.warn('[NewCorban] Token expirado no ranking, renovando e retentando...');
      clearToken();
      return getRanking(startDate, endDate, false);
    }
    throw new Error(
      `Falha ao buscar ranking: ${err.response?.data?.message || err.message}`,
    );
  }
}

async function getProposals(startDate, endDate, vendedorIds = [], _retry = true) {
  const cacheKey = `proposals:${startDate}:${endDate}:${[...vendedorIds].sort().join(',')}`;

  // Retorna do cache se ainda válido
  const cached = cacheGet(cacheKey);
  if (cached !== null) {
    console.log(`[NewCorban] propostas (cache): ${Object.keys(cached).length} registros (${startDate}→${endDate})`);
    return cached;
  }

  // Se já há uma chamada em andamento com os mesmos params, aguarda ela
  if (_inflight.has(cacheKey)) {
    return _inflight.get(cacheKey);
  }

  const body = {
    auth: {
      username: process.env.NEWCORBAN_API_USERNAME || 'botapi',
      password: process.env.NEWCORBAN_API_PASSWORD || 'api@bot321',
      empresa: process.env.NEWCORBAN_SUBDOMAIN || 'grupodigital',
    },
    requestType: 'getPropostas',
    filters: {
      data: { tipo: 'cadastro', startDate, endDate },
      produto: ['7', '13'],
      ...(vendedorIds.length > 0 ? { vendedor: vendedorIds.map(Number) } : {}),
    },
  };

  const promise = axios.post(
    'https://api.newcorban.com.br/api/propostas/',
    body,
    { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
  ).then(({ data }) => {
    if (data && data.error) {
      throw new Error(`API propostas: ${data.mensagem || 'Credenciais inválidas'}`);
    }
    console.log(`[NewCorban] propostas: ${Object.keys(data || {}).length} registros (${startDate}→${endDate})`);
    cacheSet(cacheKey, data);
    return data;
  }).finally(() => {
    _inflight.delete(cacheKey);
  });

  _inflight.set(cacheKey, promise);

  try {
    return await promise;
  } catch (err) {
    // getProposals usa auth própria (não o token v2), sem retry de token aqui
    throw new Error(`Falha ao buscar propostas: ${err.response?.data?.message || err.message}`);
  }
}

module.exports = {
  getToken,
  clearToken,
  getAllUsers,
  getUsersPage,
  findUserByUsername,
  getRanking,
  getProposals,
};
