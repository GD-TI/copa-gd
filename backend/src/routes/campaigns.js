const express = require('express');
const db = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { responseCache } = require('../middleware/responseCache');
const { getProposalsV3 } = require('../services/externalApi');

const router = express.Router();

/** Data de hoje no fuso de São Paulo (en-CA formata como YYYY-MM-DD). */
function todayBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function pgDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Escada de prêmios cumulativa.
 *
 * Conferido contra o documento da Missão Resgate:
 *   20 vendas → R$ 110   ·   25 vendas → R$ 160   ·   9 vendas → falta 1 para a próxima faixa
 */
function ladderFor(count, ladder = [], step = null, spinEvery = null) {
  const tiers = [...ladder].sort((a, b) => a.at - b.at);
  let prize = 0;

  for (const t of tiers) {
    if (count >= t.at) prize += Number(t.prize) || 0;
  }

  const lastTierAt = tiers.length ? tiers[tiers.length - 1].at : 0;

  // Faixas repetidas depois da última ("a cada +5 vendas, +R$20")
  if (step?.every > 0 && count > lastTierAt) {
    const extra = Math.floor((count - lastTierAt) / step.every);
    prize += extra * (Number(step.prize) || 0);
  }

  let nextAt = null;
  let nextPrize = null;
  const upcoming = tiers.find(t => t.at > count);
  if (upcoming) {
    nextAt = upcoming.at;
    nextPrize = Number(upcoming.prize) || 0;
  } else if (step?.every > 0) {
    const stepsDone = Math.floor((count - lastTierAt) / step.every);
    nextAt = lastTierAt + (stepsDone + 1) * step.every;
    nextPrize = Number(step.prize) || 0;
  }

  return {
    prize_value: prize,
    spins: spinEvery > 0 ? Math.floor(count / spinEvery) : 0,
    next_at: nextAt,
    next_prize: nextPrize,
    missing: nextAt === null ? null : nextAt - count,
  };
}

/** Contas não-humanas: a IA é a linha de base da campanha, não concorrente. */
function buildExcluder(rows) {
  const ids = new Set(rows.filter(r => r.corban_id).map(r => String(r.corban_id)));
  const patterns = rows
    .filter(r => r.name_pattern)
    .map(r => {
      const rx = String(r.name_pattern)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*');
      return new RegExp(`^${rx}$`, 'i');
    });

  return (vendorId, vendorName) => {
    if (ids.has(String(vendorId))) return true;
    const name = String(vendorName || '').trim();
    return name !== '' && patterns.some(rx => rx.test(name));
  };
}

async function loadCampaign(id) {
  const { rows } = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
  return rows[0] || null;
}

// ── Listagem ────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, subtitle, start_date, end_date, color, metric,
             product_ids, require_same_day, ladder, ladder_step, spin_every,
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
router.get('/:id/board', authMiddleware, responseCache(30_000), async (req, res) => {
  try {
    const campaign = await loadCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada' });

    // Resultado congelado vence a API — histórico não muda depois do encerramento
    if (campaign.status === 'closed') {
      const { rows: frozen } = await db.query(
        `SELECT position, vendor_id, vendor_name, contracts, total_value, prize_value, spins
         FROM campaign_results WHERE campaign_id = $1 ORDER BY position`,
        [campaign.id]
      );
      if (frozen.length) {
        return res.json({
          campaign: { ...campaign, start_date: pgDateStr(campaign.start_date), end_date: pgDateStr(campaign.end_date) },
          date: pgDateStr(campaign.end_date) || pgDateStr(campaign.start_date),
          frozen: true,
          board: frozen.map(r => ({
            ...r,
            contracts: Number(r.contracts),
            total_value: Number(r.total_value),
            prize_value: Number(r.prize_value),
          })),
          totals: {
            contracts: frozen.reduce((s, r) => s + Number(r.contracts), 0),
            value: frozen.reduce((s, r) => s + Number(r.total_value), 0),
          },
        });
      }
    }

    const day = req.query.date || pgDateStr(campaign.start_date) || todayBR();
    const products = new Set((campaign.product_ids || []).map(String));

    // Pagas no dia; o filtro de cadastro no mesmo dia vem logo abaixo.
    // TTL curto: num placar ao vivo, o vendedor precisa ver a própria venda entrar.
    const proposals = await getProposalsV3(day, day, [], 'payment', ['paid'], 60_000);

    const { rows: excRows } = await db.query(
      `SELECT corban_id, name_pattern FROM ranking_exclusions WHERE active = true`
    );
    const isExcluded = buildExcluder(excRows);

    const byVendor = new Map();
    let excludedContracts = 0;   // contas não-humanas
    let otherDayContracts = 0;   // pagos hoje, mas digitados em outro dia
    let otherProductContracts = 0;
    let paidTotal = 0;

    for (const p of Object.values(proposals)) {
      const paid = p.datas?.pagamento ? String(p.datas.pagamento).slice(0, 10) : null;
      if (paid !== day) continue;
      paidTotal++;

      if (products.size && !products.has(String(p.proposta?.produto_id))) { otherProductContracts++; continue; }

      // "Digitado e pago no mesmo dia" — comparação por contrato, não por agregado
      if (campaign.require_same_day) {
        const created = p.datas?.cadastro ? String(p.datas.cadastro).slice(0, 10) : null;
        if (created !== day) { otherDayContracts++; continue; }
      }

      const vid = String(p.vendedor_id || '');
      if (!vid) continue;

      const vname = p.vendedor_nome || '';
      if (isExcluded(vid, vname)) { excludedContracts++; continue; }

      if (!byVendor.has(vid)) {
        byVendor.set(vid, { vendor_id: vid, vendor_name: vname, team: p.equipe_nome || '', contracts: 0, total_value: 0 });
      }
      const agg = byVendor.get(vid);
      agg.contracts += 1;
      agg.total_value += parseFloat(p.proposta?.valor_referencia || 0) || 0;
      if (!agg.vendor_name && vname) agg.vendor_name = vname;
    }

    // Nome do vendedor pela base local quando a API não trouxe
    const missingNames = [...byVendor.values()].filter(v => !v.vendor_name).map(v => v.vendor_id);
    if (missingNames.length) {
      const { rows: users } = await db.query(
        `SELECT corban_id, COALESCE(display_name, corban_name, username) AS nome
         FROM users WHERE corban_id = ANY($1)`,
        [missingNames]
      );
      const nameById = new Map(users.map(u => [String(u.corban_id), u.nome]));
      for (const v of byVendor.values()) {
        if (!v.vendor_name) v.vendor_name = nameById.get(v.vendor_id) || `Consultor ${v.vendor_id}`;
      }
    }

    const board = [...byVendor.values()]
      .sort((a, b) => b.contracts - a.contracts || b.total_value - a.total_value)
      .map((v, i) => ({
        position: i + 1,
        ...v,
        ...ladderFor(v.contracts, campaign.ladder, campaign.ladder_step, campaign.spin_every),
      }));

    res.json({
      campaign: { ...campaign, start_date: pgDateStr(campaign.start_date), end_date: pgDateStr(campaign.end_date) },
      date: day,
      frozen: false,
      board,
      totals: {
        contracts: board.reduce((s, v) => s + v.contracts, 0),
        value: board.reduce((s, v) => s + v.total_value, 0),
        participants: board.length,
      },
      // Diagnóstico: distingue "ninguém vendeu" de "o filtro está apertado demais".
      // No dia da campanha isso é o que evita horas de dúvida sobre o placar.
      diagnostics: {
        paid_today: paidTotal,
        excluded_non_human: excludedContracts,
        other_product: otherProductContracts,
        paid_but_registered_another_day: otherDayContracts,
      },
    });
  } catch (err) {
    console.error('[Campaigns] placar:', err.message);
    res.status(502).json({ error: 'Não foi possível carregar o placar', detail: err.message });
  }
});

// ── Administração ───────────────────────────────────────────────────────────
const EDITABLE = [
  'name', 'subtitle', 'start_date', 'end_date', 'color', 'metric',
  'product_ids', 'require_same_day', 'ladder', 'ladder_step', 'spin_every', 'status',
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
