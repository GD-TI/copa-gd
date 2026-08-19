const { listarEquipe } = require('./externalApi');

/**
 * Mapa vendedor → franquia, a partir do cadastro de consultores do NewCorban.
 *
 * O nome do campo não está documentado e não é o mesmo em toda instalação, então
 * ele é resolvido por sondagem na primeira carga. Se nenhum candidato aparecer,
 * a função **lança** em vez de devolver conjunto vazio: num placar de TV, filtrar
 * por um campo inexistente esvaziaria a tela sem ninguém entender por quê.
 */

// Ordem importa: o primeiro que existir no cadastro vence.
const CAMPOS_CANDIDATOS = [
  'franquia_id', 'franchise_id',
  'franquia.id', 'franchise.id',
  'unidade_id', 'unit_id', 'filial_id', 'branch_id',
  'franquia', 'franchise', 'unidade', 'filial',
];

/**
 * A matriz é a AUSÊNCIA de franquia, não um id.
 *
 * Verificado contra o espelho da NewCorban em 10/08/2026: consultor de franquia
 * tem `franquia_id` preenchido (6 = Tatuapé, 7 = Guarulhos Centro, 24 = Gabriel
 * Machado, 865 = Indaiatuba); quem é da sede vem com o campo nulo, nas equipes
 * PROPÓSITO, GARRA, DETERMINAÇÃO, HOME, ADM e ABUNDANCIA. E `franquia_id = 1`
 * NÃO é a matriz — é a Franquia Mauá, com os 10 usuários desativados desde 2024.
 * Daí este token: `franquia_ids = ARRAY['matriz']` seleciona quem não tem franquia.
 */
const SEM_FRANQUIA = 'matriz';

/**
 * Franquias que existem no cadastro mas não estão em operação.
 *
 * O catálogo é derivado do NewCorban de propósito — franquia nova aparece
 * sozinha, sem registro paralelo para desatualizar. Só que o cadastro guarda
 * unidade encerrada, teste e parceria antiga, e todas apareciam no passo de
 * abrangência do formulário como se ainda desse para escolher. Levantamento com
 * o cliente em 19/08/2026: operam hoje a matriz, Tatuapé (6), Guarulhos Centro
 * (7), Gabriel Machado (24) e Indaiatuba (865).
 *
 * É lista de EXCLUSÃO, não de inclusão: a franquia que abrir amanhã continua
 * aparecendo sozinha, que é o motivo de o catálogo ser derivado. Para esconder
 * outra, acrescente o id aqui; para trazer uma de volta, remova a linha.
 *
 * Só muda o que as telas OFERECEM. `getSellerIdsPorFranquia` fica de fora de
 * propósito: campanha antiga apontada para uma destas continua somando os
 * vendedores dela — esconder do formulário não pode reescrever placar publicado.
 */
const FRANQUIAS_INATIVAS = new Map([
  ['1',    'Mauá — 10 usuários, todos desativados desde 2024'],
  ['2',    'Vila Prudente'],
  ['3',    'Santo Amaro'],
  ['4',    'São Caetano'],
  ['5',    'Itaquera'],
  ['13',   'sem nome no cadastro'],
  ['20',   'Boa Vista'],
  ['50',   'Vasconcelos'],
  ['317',  'Parceiros'],
  ['995',  'Vittare'],
  ['1097', 'sem nome no cadastro'],
]);

const TTL_MS = 15 * 60 * 1000;   // cadastro de consultor não muda no meio do dia

let _cache = null;   // { expiresAt, campo, porVendedor: Map<string, string> }
let _inflight = null;

function achatar(obj, prefixo = '', saida = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) achatar(v, chave, saida);
    else saida[chave] = v;
  }
  return saida;
}

function temValor(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/** O campo certo é o que está preenchido para a maioria dos consultores. */
function resolverCampo(usuarios) {
  const planos = usuarios.map(u => achatar(u));

  for (const campo of CAMPOS_CANDIDATOS) {
    const preenchidos = planos.filter(p => temValor(p[campo])).length;
    if (preenchidos > 0) return { campo, preenchidos };
  }

  const disponiveis = [...new Set(planos.flatMap(p => Object.keys(p)))].sort();
  throw new Error(
    `Nenhum campo de franquia no cadastro do NewCorban. ` +
    `Procurei por: ${CAMPOS_CANDIDATOS.join(', ')}. ` +
    `Campos que existem: ${disponiveis.join(', ')}. ` +
    `Rode "node scripts/descobrir-franquia.js" e ajuste CAMPOS_CANDIDATOS.`
  );
}

async function carregar() {
  // equipe.php, não apiv2 /users: só ele traz franquia_id
  const usuarios = await listarEquipe();
  if (!usuarios?.length) throw new Error('Cadastro de consultores do NewCorban veio vazio');

  const { campo, preenchidos } = resolverCampo(usuarios);

  // Todo consultor entra no mapa: sem franquia vira o token da matriz, e não
  // um buraco que o filtro leria como "não é de lugar nenhum".
  const porVendedor = new Map();
  // Contas não-humanas pela flag do próprio cadastro. Padrão de nome não basta:
  // "NOVA IA" é robô e não casa com API%/BOT%/ROBO%, e entraria no placar
  // disputando com os consultores — exatamente o que a campanha proíbe.
  const robos = new Set();
  // Procedência de cada consultor. O `equipe.php` já traz equipe e franquia e a
  // gente descartava — no ranking individual, que roda com a empresa inteira,
  // são 60+ nomes seguidos e sem isso não dá para saber quem é de onde.
  const info = new Map();
  for (const u of usuarios) {
    const valor = achatar(u)[campo];
    const franquia = temValor(valor) ? String(valor).trim() : SEM_FRANQUIA;
    porVendedor.set(String(u.id), franquia);
    info.set(String(u.id), {
      equipe: u.equipe_nome || null,
      franquia,
      franquia_nome: u.franquia_nome || (franquia === SEM_FRANQUIA ? 'Matriz' : null),
    });
    if (u.robo === 1 || u.robo === true || String(u.robo) === '1') robos.add(String(u.id));
  }

  const naMatriz = [...porVendedor.values()].filter(v => v === SEM_FRANQUIA).length;
  console.log(
    `[Franquia] campo "${campo}" — ${preenchidos}/${usuarios.length} com franquia, ` +
    `${naMatriz} sem (matriz); ${new Set(porVendedor.values()).size} valor(es) distinto(s); ` +
    `${robos.size} conta(s) marcada(s) como robô`
  );

  return { expiresAt: Date.now() + TTL_MS, campo, porVendedor, robos, info };
}

/** Map<vendedor_id, franquia_id>. Cacheado 15 min, com dedup de chamadas. */
async function getMapaFranquias() {
  if (_cache && Date.now() < _cache.expiresAt) return _cache;
  if (_inflight) return _inflight;

  _inflight = carregar()
    .then(novo => { _cache = novo; return novo; })
    .finally(() => { _inflight = null; });

  return _inflight;
}

/**
 * Conjunto de vendedores das franquias pedidas (ex: ['1'] = matriz).
 * Lança se o cadastro não puder ser lido — quem chama decide o que mostrar.
 */
async function getSellerIdsPorFranquia(franquiaIds = []) {
  const alvo = new Set(franquiaIds.map(f => String(f).trim()).filter(Boolean));
  if (alvo.size === 0) return null;   // sem filtro

  const { porVendedor, campo } = await getMapaFranquias();

  const ids = new Set();
  for (const [vendedorId, franquia] of porVendedor.entries()) {
    if (alvo.has(franquia)) ids.add(vendedorId);
  }

  if (ids.size === 0) {
    const vistos = [...new Set(porVendedor.values())].sort().slice(0, 20);
    throw new Error(
      `Nenhum consultor na(s) franquia(s) ${[...alvo].join(', ')} pelo campo "${campo}". ` +
      `Valores encontrados: ${vistos.join(', ')}`
    );
  }

  return ids;
}

/**
 * Vendedores marcados como robô no cadastro do NewCorban.
 * Devolve null se o cadastro não puder ser lido — quem chama cai de volta nos
 * padrões de nome em vez de deixar o placar vazio.
 */
async function getRoboSellerIds() {
  try {
    const { robos } = await getMapaFranquias();
    return robos || null;
  } catch (err) {
    console.warn('[Franquia] cadastro indisponível para marcar robôs:', err.message);
    return null;
  }
}

/**
 * Map<vendedor_id, { equipe, franquia, franquia_nome }>.
 * Devolve null se o cadastro não puder ser lido — a procedência é enfeite, e o
 * ranking não pode sumir da TV por causa dela.
 */
async function getInfoVendedores() {
  try {
    const { info } = await getMapaFranquias();
    return info || null;
  } catch (err) {
    console.warn('[Franquia] cadastro indisponível para procedência:', err.message);
    return null;
  }
}

/**
 * Catálogo de franquias para as telas: `[{ id, nome, consultores }]`.
 *
 * Não existe tabela local de franquias — a lista é derivada do cadastro do
 * NewCorban, a mesma fonte que o placar usa para filtrar. Assim uma franquia
 * nova aparece sozinha no formulário, sem cadastro paralelo para desatualizar.
 *
 * As de `FRANQUIAS_INATIVAS` ficam de fora. `manter` traz de volta ids
 * específicos — o vínculo de um dono de franquia e a abrangência de uma campanha
 * já criada valem mais que a lista: escondê-los deixaria a conta sem franquia
 * nenhuma, ou a campanha com um filtro que ninguém enxerga para desmarcar.
 *
 * `consultores` não conta robôs: é o número que o formulário mostra para avisar
 * que uma franquia sem gente produziria um placar vazio.
 */
async function listarFranquias({ manter = [] } = {}) {
  const { porVendedor, info, robos } = await getMapaFranquias();
  const preservar = new Set((manter || []).map(f => String(f).trim()).filter(Boolean));

  const porId = new Map();
  for (const [vendedorId, franquia] of porVendedor.entries()) {
    if (!porId.has(franquia)) porId.set(franquia, { id: franquia, nome: null, consultores: 0 });
    const f = porId.get(franquia);
    if (!f.nome) f.nome = info.get(vendedorId)?.franquia_nome || null;
    if (!robos?.has(vendedorId)) f.consultores += 1;
  }

  return [...porId.values()]
    .filter(f => !FRANQUIAS_INATIVAS.has(f.id) || preservar.has(f.id))
    .map(f => ({
      ...f,
      nome: f.nome || (f.id === SEM_FRANQUIA ? 'Matriz' : `Franquia ${f.id}`),
    }))
    .sort((a, b) => {
      if (a.id === SEM_FRANQUIA) return -1;          // matriz sempre primeiro
      if (b.id === SEM_FRANQUIA) return 1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

function invalidarCacheFranquias() {
  _cache = null;
}

module.exports = {
  TOKEN_MATRIZ: SEM_FRANQUIA,
  FRANQUIAS_INATIVAS,
  getSellerIdsPorFranquia,
  getMapaFranquias,
  getRoboSellerIds,
  getInfoVendedores,
  listarFranquias,
  invalidarCacheFranquias,
};
