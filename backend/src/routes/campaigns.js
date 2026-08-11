const express = require('express');
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { responseCache } = require('../middleware/responseCache');
const { montarPlacar, todayBR, pgDateStr, diaDoPlacar } = require('../services/campaignBoard');
const { congelarCampanha, lerCongelado } = require('../services/campaignFreezer');
const { fetchGroupsRanking } = require('./groups');
const { fetchIndividualRankings } = require('./scores');

const router = express.Router();

// Frescor da resposta HTTP do placar. O cálculo em si (e o TTL das propostas na
// NewCorban) mora em services/campaignBoard.js, compartilhado com o congelador.
const CACHE_DIA_VIVO = 30_000;
const CACHE_DIA_ENCERRADO = 10 * 60_000;

async function loadCampaign(id) {
  const { rows } = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ── Listagem ────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, subtitle, start_date, end_date, color, metric,
             product_ids, require_same_day, franquia_ids, ladder, ladder_step, spin_every,
             status, legacy_kind, created_at
      FROM campaigns
      ORDER BY (status = 'active') DESC, COALESCE(start_date, created_at::date) DESC, id DESC
    `);
    res.json(rows.map(c => ({
      ...c,
      start_date: pgDateStr(c.start_date),
      end_date: pgDateStr(c.end_date),
    })));
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
router.post('/archive-legacy', authMiddleware, adminOnly, async (req, res) => {
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

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ ...c, start_date: pgDateStr(c.start_date), end_date: pgDateStr(c.end_date) });
  } catch (err) {
    console.error('[Campaigns] detalhe:', err.message);
    res.status(500).json({ error: 'Erro ao carregar campanha' });
  }
});

// ── Placar ao vivo ──────────────────────────────────────────────────────────
router.get('/:id/board', authMiddleware, responseCache(CACHE_DIA_VIVO), async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

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
router.post('/:id/freeze', authMiddleware, adminOnly, async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (campaign.legacy_kind) return res.status(400).json({ error: 'Campanha legada não usa placar por escada' });

    const r = await congelarCampanha(campaign, { force: true });
    res.json(r);
  } catch (err) {
    console.error('[Campaigns] congelar:', err.message);
    res.status(502).json({ error: 'Não foi possível congelar o placar', detail: err.message });
  }
});

// ── Administração ───────────────────────────────────────────────────────────
const EDITABLE = [
  'name', 'subtitle', 'start_date', 'end_date', 'color', 'metric',
  'product_ids', 'require_same_day', 'franquia_ids', 'ladder', 'ladder_step', 'spin_every', 'status',
];

router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

    const { rows } = await db.query(
      `INSERT INTO campaigns (name, subtitle, start_date, end_date, color, metric,
                              product_ids, require_same_day, ladder, ladder_step, spin_every, status, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'azul'),COALESCE($6,'contratos'),
               COALESCE($7,ARRAY['13']),COALESCE($8,false),
               COALESCE($9,'[]')::jsonb,$10::jsonb,$11,'draft',$12)
       RETURNING *`,
      [
        String(name).trim(), req.body.subtitle || null,
        req.body.start_date || null, req.body.end_date || null,
        req.body.color, req.body.metric,
        req.body.product_ids, req.body.require_same_day,
        req.body.ladder ? JSON.stringify(req.body.ladder) : null,
        req.body.ladder_step ? JSON.stringify(req.body.ladder_step) : null,
        req.body.spin_every ?? null, req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[Campaigns] criação:', err.message);
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const sets = [];
    const values = [];
    for (const key of EDITABLE) {
      if (!(key in req.body)) continue;
      let v = req.body[key];
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
    res.json(rows[0]);
  } catch (err) {
    console.error('[Campaigns] atualização:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

module.exports = router;
