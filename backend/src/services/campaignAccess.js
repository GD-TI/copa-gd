/**
 * Quem vê, cria e edita campanha.
 *
 * Funções puras, sem Express e sem banco: a regra de quem enxerga o quê é a
 * parte que, se errar, vaza campanha de uma franquia para outra — e regra dessas
 * precisa ser testável direto, não só através de uma requisição HTTP.
 *
 * Vocabulário:
 *   escopo = null  → todas as franquias (matriz)
 *   escopo = []    → nenhuma (dono sem vínculo; estado inválido para criar)
 *   escopo = [...] → só essas
 */

class ErroDeEscopo extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErroDeEscopo';
    this.status = 400;
  }
}

/** Contexto de acesso a partir do usuário logado e do escopo já carregado. */
function contexto(user, escopo) {
  const master = user?.role === 'admin';
  return {
    master,
    franqueado: user?.role === 'franqueado',
    // Franquias do próprio usuário. Master não tem lista — tem tudo.
    franquias: master ? null : (escopo || []),
  };
}

/** A campanha alcança alguma das franquias do usuário? (sem alcance = todas) */
function alcancaOUsuario(ctx, campaign) {
  const alcance = campaign.franquia_ids;
  if (!alcance || alcance.length === 0) return true;      // campanha da empresa inteira
  return alcance.some(f => ctx.franquias.includes(f));
}

/**
 * Visibilidade — uma função só, aplicada tanto na lista quanto ao abrir uma
 * campanha pelo id.
 *
 * Filtrar em JS e não em SQL é decisão consciente: campanhas são dezenas (a rota
 * sempre leu todas), e uma cláusula SQL paralela a esta função seria uma segunda
 * verdade capaz de divergir em silêncio — justo na regra que, se errar, mostra
 * campanha de uma franquia para outra.
 */
function podeVer(ctx, campaign) {
  if (ctx.master) return true;
  if (!campaign) return false;

  if (ctx.franqueado) {
    // As próprias, e as que a matriz criou incluindo a franquia dele. Rascunho
    // da matriz também aparece: quem vai receber a campanha precisa poder
    // conferir antes de ela valer — e só a matriz consegue ativá-la.
    if (campaign.owner_franquia_id) return ctx.franquias.includes(campaign.owner_franquia_id);
    return alcancaOUsuario(ctx, campaign);
  }

  // Consultor e sub-admin: só campanha valendo, e só se ele estiver dentro dela.
  return campaign.status !== 'draft' && alcancaOUsuario(ctx, campaign);
}

/**
 * Abrangência efetiva de uma campanha nova.
 *
 * A do franqueado vem do escopo dele e **ignora o corpo da requisição** — é o
 * que faz "só a matriz cria para todas" ser regra de API, e não de tela.
 *
 * O escopo vazio é recusado de propósito: `franquia_ids = []` é lido como "sem
 * filtro" lá no placar (`getSellerIdsPorFranquia` devolve null), então um dono
 * sem vínculo acabaria criando campanha da empresa inteira.
 */
function abrangenciaParaCriacao(ctx, franquiaIdsPedidas) {
  if (ctx.master) {
    const pedidas = (franquiaIdsPedidas || []).map(f => String(f).trim()).filter(Boolean);
    return pedidas.length ? [...new Set(pedidas)] : null;   // null = empresa inteira
  }

  if (!ctx.franqueado) throw new ErroDeEscopo('Sem permissão para criar campanha');
  if (!ctx.franquias.length) {
    throw new ErroDeEscopo(
      'Sua conta não está vinculada a nenhuma franquia. Peça à matriz para configurar o acesso.'
    );
  }
  return [...ctx.franquias];
}

/** Franquia registrada como dona. NULL para a matriz (abrangência livre). */
function donoDaCampanha(ctx) {
  return ctx.master ? null : ctx.franquias[0] || null;
}

function podeEditar(ctx, campaign) {
  if (ctx.master) return true;
  if (!ctx.franqueado || !campaign) return false;
  // Campanha da matriz (dono NULL) é só leitura para o franqueado, mesmo que a
  // franquia dele participe.
  return Boolean(campaign.owner_franquia_id) && ctx.franquias.includes(campaign.owner_franquia_id);
}

/**
 * Campos que cada papel pode alterar.
 *
 * Abrangência e dono ficam fora da lista do franqueado: deixá-los editáveis
 * desfaria, no PUT, o travamento feito na criação.
 */
const CAMPOS_EDITAVEIS = [
  'name', 'subtitle', 'start_date', 'end_date', 'color', 'metric',
  'product_ids', 'require_same_day', 'franquia_ids', 'ladder', 'ladder_step',
  'spin_every', 'status',
];
const CAMPOS_SO_DA_MATRIZ = new Set(['franquia_ids']);

function camposEditaveis(ctx) {
  if (ctx.master) return CAMPOS_EDITAVEIS;
  return CAMPOS_EDITAVEIS.filter(c => !CAMPOS_SO_DA_MATRIZ.has(c));
}

module.exports = {
  ErroDeEscopo,
  contexto,
  podeVer,
  abrangenciaParaCriacao,
  donoDaCampanha,
  podeEditar,
  camposEditaveis,
  CAMPOS_EDITAVEIS,
};
