const express = require('express');
const db = require('../config/db');
const {
  authMiddleware, adminOnly, campaignAdminOnly, attachFranquiaScopes,
} = require('../middleware/auth');
const { responseCache } = require('../middleware/responseCache');
const { montarPlacar, todayBR, pgDateStr, diaDoPlacar } = require('../services/campaignBoard');
const { congelarCampanha, lerCongelado } = require('../services/campaignFreezer');
const {
  ErroDeEscopo, contexto, podeVer, abrangenciaParaCriacao,
  donoDaCampanha, podeEditar, camposEditaveis,
} = require('../services/campaignAccess');
const { fetchGroupsRanking } = require('./groups');
const { fetchIndividualRankings } = require('./scores');

const router = express.Router();

// Frescor da resposta HTTP do placar. O cálculo em si (e o TTL das propostas na
// NewCorban) mora em services/campaignBoard.js, compartilhado com o congelador.
const CACHE_DIA_VIVO = 30_000;
const CACHE_DIA_ENCERRADO = 10 * 60_000;
const STATUS_EDITAVEIS = new Set(['draft', 'active', 'closed']);

// Toda rota de campanha precisa do escopo de franquia — inclusive as de leitura,
// porque é ele que decide o que aparece. Declarado uma vez aqui para nenhuma
// rota nova nascer sem a checagem.
router.use(authMiddleware, attachFranquiaScopes);

const acessoDe = req => contexto(req.user, req.franquiaIds);

const comDatas = c => ({ ...c, start_date: pgDateStr(c.start_date), end_date: pgDateStr(c.end_date) });

/**
 * `product_ids = []` é diferente de "o campo não veio": o `COALESCE` do INSERT
 * só protege contra NULL/undefined, não array vazio. Sem esta guarda, lista
 * vazia faz `montarPlacar` tratar como "sem filtro" — todos os produtos contam,
 * o oposto do que o campo deveria significar. Mesma armadilha que
 * `franquia_ids` já trata de propósito (lá o vazio É a regra: sem filtro);
 * aqui o significado é o contrário, então a recusa é o comportamento certo.
 * Só bloqueia quando o campo veio no corpo — omitido continua caindo no
 * default (`ARRAY['13']`).
 */
function erroDeProdutosVazios(body) {
  if ('product_ids' in body && Array.isArray(body.product_ids) && body.product_ids.length === 0) {
    return 'Selecione ao menos um produto';
  }
  return null;
}

async function loadCampaign(id) {
  const { rows } = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Carrega a campanha da URL e barra quem não pode vê-la.
 *
 * É middleware, e não uma checagem dentro do handler, por causa do `/board`: o
 * `responseCache` responde antes do handler, então uma verificação lá dentro
 * seria pulada sempre que a resposta viesse do cache.
 */
async function carregarCampanha(req, res, next) {
  try {
    const campaign = await loadCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

    const acesso = acessoDe(req);
    if (!podeVer(acesso, campaign)) {
      return res.status(403).json({ error: 'Sem acesso a esta campanha' });
    }

    req.campaign = campaign;
    req.acesso = acesso;
    next();
  } catch (err) {
    console.error('[Campaigns] carregar:', err.message);
    res.status(500).json({ error: 'Erro ao carregar campanha' });
  }
}

// ── Listagem ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT c.id, c.name, c.subtitle, c.start_date, c.end_date, c.color, c.metric,
             c.product_ids, c.require_same_day, c.franquia_ids, c.owner_franquia_id,
             c.ladder, c.ladder_step, c.spin_every,
             c.status, c.legacy_kind, c.created_at,
             (c.legacy_kind IS NOT NULL OR EXISTS (
               SELECT 1 FROM campaign_results cr WHERE cr.campaign_id = c.id
             )) AS frozen
      FROM campaigns c
      ORDER BY (c.status = 'active') DESC, COALESCE(c.start_date, c.created_at::date) DESC, c.id DESC
    `);

    const acesso = acessoDe(req);
    res.json(
      rows
        .filter(c => podeVer(acesso, c))
        // `pode_editar` evita a tela ter que reimplementar a regra de permissão
        .map(c => ({ ...comDatas(c), pode_editar: podeEditar(acesso, c) }))
    );
  } catch (err) {
    console.error('[Campaigns] listagem:', err.message);
    res.status(500).json({ error: 'Erro ao listar campanhas' });
  }
});

/**
 * Arquiva a Copa GD 2026 (o sistema antigo de equipes/score_events, que não é
 * preso a nenhuma linha de `campaigns`) como uma campanha congelada, com uma
 * foto do ranking de equipes e dos rankings individuais de agora. Sem isso,
 * um card "Copa GD 2026" teria que ficar lendo campaign_settings/score_events
 * ao vivo — e mostraria dados errados se esse sistema for reaproveitado no
 * futuro para uma campanha nova (mesmas tabelas, datas diferentes).
 *
 * Idempotente: rodar de novo atualiza a foto de uma linha já arquivada em vez
 * de criar duplicata (útil se algo precisar ser corrigido antes do primeiro
 * uso real do card).
 */
router.post('/archive-legacy', adminOnly, async (req, res) => {
  try {
    const [ranking, indRankings] = await Promise.all([
      fetchGroupsRanking(),
      fetchIndividualRankings(),
    ]);

    const snapshot = { groups: ranking.groups, indRankings };
    const { rows: existing } = await db.query(
      `SELECT id FROM campaigns WHERE legacy_kind = 'team_scoring'`
    );

    let row;
    if (existing.length) {
      ({ rows: [row] } = await db.query(
        `UPDATE campaigns SET legacy_snapshot = $1::jsonb, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [JSON.stringify(snapshot), existing[0].id]
      ));
    } else {
      ({ rows: [row] } = await db.query(
        `INSERT INTO campaigns (name, subtitle, start_date, end_date, color, status, legacy_kind, legacy_snapshot, created_by)
         VALUES ($1, $2, $3, $4, 'azul', 'closed', 'team_scoring', $5::jsonb, $6)
         RETURNING *`,
        [
          'Copa GD 2026',
          'Ranking por equipe e individual · dados congelados',
          ranking.campaign?.start_date || null,
          ranking.campaign?.end_date || null,
          JSON.stringify(snapshot),
          req.user.id,
        ]
      ));
    }

    res.json({ ...row, start_date: pgDateStr(row.start_date), end_date: pgDateStr(row.end_date) });
  } catch (err) {
    console.error('[Campaigns] archive-legacy:', err.message);
    res.status(500).json({ error: 'Erro ao arquivar a Copa GD 2026' });
  }
});

router.get('/:id', carregarCampanha, (req, res) => {
  res.json({ ...comDatas(req.campaign), pode_editar: podeEditar(req.acesso, req.campaign) });
});

// ── Placar ao vivo ──────────────────────────────────────────────────────────
router.get('/:id/board', carregarCampanha, responseCache(CACHE_DIA_VIVO), async (req, res) => {
  try {
    const { campaign } = req;

    // Campanha do sistema antigo (equipes/score_events), arquivada por
    // POST /archive-legacy: forma de dados totalmente diferente do placar por
    // giro/escada abaixo — ranking de equipes + os dois rankings individuais,
    // já prontos, sem NewCorban nem ladder nenhuma.
    if (campaign.legacy_kind) {
      return res.json({
        campaign: { ...campaign, start_date: pgDateStr(campaign.start_date), end_date: pgDateStr(campaign.end_date) },
        legacy: true,
        frozen: true,
        snapshot: campaign.legacy_snapshot || { groups: [], indRankings: { melhor_vendedor: [], rei_assistencias: [] } },
      });
    }

    // Resultado congelado vence a API — histórico não muda depois do encerramento.
    // Só vale para o dia da própria campanha: ?date= pedindo outro dia continua
    // reconstruindo, senão o snapshot responderia por uma data que não é a dele.
    if (campaign.status === 'closed' && !req.query.date) {
      const congelado = await lerCongelado(campaign);
      if (congelado) {
        // Cache longo: por definição isso não muda mais.
        res.locals.cacheTtlMs = CACHE_DIA_ENCERRADO;
        return res.json({
          campaign: { ...campaign, start_date: pgDateStr(campaign.start_date), end_date: pgDateStr(campaign.end_date) },
          frozen: true,
          ...congelado,
        });
      }
    }

    const day = diaDoPlacar(campaign, req.query.date);
    const { board, totals, diagnostics } = await montarPlacar(campaign, day);

    // Dia já encerrado não recebe venda nova e aguenta ficar quente por mais
    // tempo. O dia corrente segue com o TTL curto de sempre.
    res.locals.cacheTtlMs = day < todayBR() ? CACHE_DIA_ENCERRADO : CACHE_DIA_VIVO;
    res.json({
      campaign: { ...campaign, start_date: pgDateStr(campaign.start_date), end_date: pgDateStr(campaign.end_date) },
      date: day,
      frozen: false,
      board,
      totals,
      diagnostics,
    });
  } catch (err) {
    console.error('[Campaigns] placar:', err.message);
    res.status(502).json({ error: 'Não foi possível carregar o placar', detail: err.message });
  }
});

/**
 * Recongela o placar a partir da NewCorban.
 *
 * O congelamento normal é automático e único (cron das 00:05). Este endpoint
 * existe para quando o número gravado precisa ser corrigido — tipicamente
 * pagamento confirmado pelo banco depois da virada.
 */
router.post('/:id/freeze', adminOnly, carregarCampanha, async (req, res) => {
  try {
    const { campaign } = req;
    if (campaign.legacy_kind) return res.status(400).json({ error: 'Campanha legada não usa placar por escada' });

    const r = await congelarCampanha(campaign, { force: true });
    res.json(r);
  } catch (err) {
    console.error('[Campaigns] congelar:', err.message);
    res.status(502).json({ error: 'Não foi possível congelar o placar', detail: err.message });
  }
});

// ── Administração ───────────────────────────────────────────────────────────

router.post('/', campaignAdminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (req.body.end_date && req.body.start_date && req.body.end_date < req.body.start_date) {
      return res.status(400).json({ error: 'A data de término não pode ser antes do início' });
    }
    const erroProdutos = erroDeProdutosVazios(req.body);
    if (erroProdutos) return res.status(400).json({ error: erroProdutos });

    const acesso = acessoDe(req);
    // Abrangência decidida aqui, não no corpo: o franqueado recebe o próprio
    // escopo e um pedido de "todas as franquias" vindo dele é simplesmente
    // ignorado. Escopo vazio lança ErroDeEscopo (400) — ver campaignAccess.js.
    const franquiaIds = abrangenciaParaCriacao(acesso, req.body.franquia_ids);
    // Rascunho continua sendo o padrão. A tela pode criar já ativa sem precisar
    // de um POST seguido de PUT, evitando campanha salva pela metade se a segunda
    // requisição falhar.
    const statusInicial = req.body.status === 'active' ? 'active' : 'draft';

    const { rows } = await db.query(
      `INSERT INTO campaigns (name, subtitle, start_date, end_date, color, metric,
                              product_ids, require_same_day, franquia_ids, owner_franquia_id,
                              ladder, ladder_step, spin_every, status, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'azul'),COALESCE($6,'contratos'),
               COALESCE($7,ARRAY['13']),COALESCE($8,false),$9,$10,
               COALESCE($11,'[]')::jsonb,$12::jsonb,$13,$14,$15)
       RETURNING *`,
      [
        String(name).trim(), req.body.subtitle || null,
        req.body.start_date || null, req.body.end_date || null,
        req.body.color, req.body.metric,
        req.body.product_ids, req.body.require_same_day,
        franquiaIds, donoDaCampanha(acesso),
        req.body.ladder ? JSON.stringify(req.body.ladder) : null,
        req.body.ladder_step ? JSON.stringify(req.body.ladder_step) : null,
        req.body.spin_every ?? null, statusInicial, req.user.id,
      ]
    );
    res.status(201).json({ ...comDatas(rows[0]), pode_editar: true });
  } catch (err) {
    if (err instanceof ErroDeEscopo) return res.status(err.status).json({ error: err.message });
    console.error('[Campaigns] criação:', err.message);
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

router.put('/:id', campaignAdminOnly, carregarCampanha, async (req, res) => {
  try {
    if (!podeEditar(req.acesso, req.campaign)) {
      return res.status(403).json({ error: 'Esta campanha é administrada pela matriz' });
    }
    if ('name' in req.body && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    if ('status' in req.body && !STATUS_EDITAVEIS.has(req.body.status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    const inicio = 'start_date' in req.body ? req.body.start_date : pgDateStr(req.campaign.start_date);
    const fim = 'end_date' in req.body ? req.body.end_date : pgDateStr(req.campaign.end_date);
    if (inicio && fim && fim < inicio) {
      return res.status(400).json({ error: 'A data de término não pode ser antes do início' });
    }
    const erroProdutos = erroDeProdutosVazios(req.body);
    if (erroProdutos) return res.status(400).json({ error: erroProdutos });

    const sets = [];
    const values = [];
    // A lista depende do papel: `franquia_ids` fica de fora para o franqueado,
    // senão o PUT desfaria o travamento de abrangência feito na criação.
    for (const key of camposEditaveis(req.acesso)) {
      if (!(key in req.body)) continue;
      const v = req.body[key];
      if (key === 'ladder' || key === 'ladder_step') {
        values.push(v === null ? null : JSON.stringify(v));
        sets.push(`${key} = $${values.length}::jsonb`);
        continue;
      }
      values.push(v);
      sets.push(`${key} = $${values.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });

    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE campaigns SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ...comDatas(rows[0]), pode_editar: podeEditar(req.acesso, rows[0]) });
  } catch (err) {
    console.error('[Campaigns] atualização:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

module.exports = router;
