const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Configuração do multer para fotos de grupos
const uploadDir = path.join(__dirname, '../../uploads/groups');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `group_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

// GET /api/groups - listar todos os grupos com pontuação
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url, g.created_at, g.daily_goal_value, g.weekly_goal_value,
        COUNT(DISTINCT gm.user_id) as member_count,
        COALESCE(se_agg.total_points, 0) + COALESCE(pa_agg.adj_points, 0) as total_points,
        COALESCE(se_agg.today_points, 0) as today_points
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT
          SUM(points) as total_points,
          SUM(CASE WHEN event_date = CURRENT_DATE THEN points ELSE 0 END) as today_points
        FROM score_events se
        WHERE se.group_id = g.id
          AND se.event_date >= COALESCE(
            (SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1),
            CURRENT_DATE
          )
          AND se.event_date <= CURRENT_DATE
      ) se_agg ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(points), 0) as adj_points
        FROM point_adjustments pa
        WHERE pa.group_id = g.id
      ) pa_agg ON true
      WHERE g.active = true
      GROUP BY g.id, g.name, g.photo_url, g.created_at, g.daily_goal_value, g.weekly_goal_value,
               se_agg.total_points, se_agg.today_points, pa_agg.adj_points
      ORDER BY total_points DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao listar grupos' });
  }
});

// GET /api/groups/ranking — ranking por período da campanha (público)
router.get('/ranking', async (req, res) => {
  try {
    // Período: query params ou busca na campanha configurada
    let { start, end } = req.query;

    if (!start || !end) {
      const { rows: camp } = await db.query(
        'SELECT start_date, end_date, name FROM campaign_settings ORDER BY id DESC LIMIT 1'
      );
      if (camp.length > 0) {
        const fmtD = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
        start = fmtD(camp[0].start_date);
        end   = fmtD(camp[0].end_date);
      } else {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      }
    }

    const { rows } = await db.query(`
      SELECT
        g.id, g.name, g.photo_url, g.daily_goal_value, g.weekly_goal_value,
        COUNT(DISTINCT gm.user_id)::int AS member_count,
        COALESCE((
          SELECT SUM(se.points) FROM score_events se
          WHERE se.group_id = g.id AND se.event_date BETWEEN $1 AND $2
        ), 0) + COALESCE((
          SELECT SUM(pa.points) FROM point_adjustments pa
          WHERE pa.group_id = g.id AND pa.adjustment_date BETWEEN $1 AND $2
        ), 0) AS total_points
      FROM groups g
      LEFT JOIN group_memberships gm ON g.id = gm.group_id
      WHERE g.active = true
      GROUP BY g.id, g.name, g.photo_url, g.daily_goal_value, g.weekly_goal_value
      ORDER BY total_points DESC
    `, [start, end]);

    // Buscar campanha para o frontend
    const { rows: camp } = await db.query(
      'SELECT id, name, start_date, end_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );

    const fmt = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

    const campaign = camp[0]
      ? { ...camp[0], start_date: fmt(camp[0].start_date), end_date: fmt(camp[0].end_date) }
      : null;

    res.json({
      groups: rows,
      campaign,
      period: { start: fmt(start), end: fmt(end) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar ranking' });
  }
});

// GET /api/groups/:id/members/points — contribuição individual em pontos por regra
// Tudo calculado a partir das propostas atuais — sem score_events
router.get('/:id/members/points', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const todayStr = new Date().toISOString().split('T')[0];

  const round2 = v => Math.round((v || 0) * 100) / 100;
  const sumVR  = ps => ps.reduce((s, p) => s + parseFloat(p.proposta?.valor_referencia || 0), 0);
  const fmtBRL = v  => `R$ ${Math.round(v || 0).toLocaleString('pt-BR')}`;

  try {
    // --- Grupo e metas ---
    const { rows: grRows } = await db.query(
      'SELECT id, name, photo_url, daily_goal_value, weekly_goal_value FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (!grRows.length) return res.status(404).json({ error: 'Grupo não encontrado' });
    const group = grRows[0];
    const dailyGoal  = parseFloat(group.daily_goal_value  || 0);
    const weeklyGoal = parseFloat(group.weekly_goal_value || 0);

    // --- Membros do grupo ---
    const { rows: members } = await db.query(
      `SELECT u.id, u.display_name, u.corban_id, gm.is_captain
       FROM group_memberships gm JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true`,
      [id]
    );

    // --- Campanha e semana ---
    const { rows: campRows } = await db.query(
      'SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
    );
    const campaignStart = campRows[0]
      ? new Date(campRows[0].start_date).toISOString().split('T')[0]
      : todayStr;

    const dNow = new Date();
    const wd = dNow.getDay();
    const weekStart = new Date(new Date().setDate(dNow.getDate() - wd + (wd === 0 ? -6 : 1))).toISOString().split('T')[0];

    // --- Multiplicador dia de jogo ---
    const { rows: matchRows } = await db.query(
      'SELECT id FROM brazil_matches WHERE match_date = $1 AND double_points = true', [todayStr]
    );
    const multiplier = matchRows.length > 0 ? 2 : 1;

    // --- Todos os grupos ativos (para regras competitivas) ---
    const { rows: allGroupsRows } = await db.query(`
      SELECT g.id,
        ARRAY_AGG(u.corban_id) FILTER (WHERE u.corban_id IS NOT NULL) as corban_ids
      FROM groups g
      JOIN group_memberships gm ON g.id = gm.group_id
      JOIN users u ON gm.user_id = u.id
      WHERE g.active = true AND u.active = true
      GROUP BY g.id
    `);
    const allCorbanIds = [...new Set(allGroupsRows.flatMap(g => g.corban_ids || []))];

    // --- Propostas de toda a campanha (cache compartilhado com o scoring) ---
    const externalApi = require('../services/externalApi');
    let globalProposals = [];
    let vendorMap = {};

    try {
      const ranking = await externalApi.getRanking(todayStr, todayStr);
      if (ranking?.result) {
        Object.values(ranking.result).forEach(v => {
          if (v.filter_value) vendorMap[String(v.filter_value)] = v;
        });
      }
    } catch (_) {}

    try {
      const pData = await externalApi.getProposals(campaignStart, todayStr, allCorbanIds);
      globalProposals = pData ? Object.values(pData) : [];
    } catch (_) {}

    // --- Propostas filtradas para o grupo atual ---
    const withCorban = members.filter(m => m.corban_id);
    const corbanIds  = withCorban.map(m => String(m.corban_id));

    const allProposals = globalProposals.filter(p => corbanIds.includes(String(p.vendedor_id)));
    const todayProps   = allProposals.filter(p => (p.datas?.cadastro || '').startsWith(todayStr));
    const weeklyProps  = allProposals.filter(p => (p.datas?.cadastro || '') >= weekStart);

    const gToday  = todayProps;
    const gWeekly = weeklyProps;
    const gAll    = allProposals;

    const gPaidTodayArr    = gToday.filter(p => p.datas?.pagamento);
    const gValorToday      = sumVR(gPaidTodayArr);
    const gValorWeek       = sumVR(gWeekly);
    const gPaidToday       = gPaidTodayArr.length;
    const gPaidAll         = gAll.filter(p => p.datas?.pagamento).length;
    const gRefAll          = gAll.filter(p => p.datas?.pagamento && p.proposta?.indicacao_id != null).length;
    const gHVAll           = gAll.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000).length;
    const gMaxContractToday = gToday.filter(p => p.datas?.pagamento).reduce((mx, p) => Math.max(mx, parseFloat(p.proposta?.valor_referencia || 0)), 0);

    // --- Regras não-competitivas: verificadas direto das propostas ---
    const metaDiaHit = dailyGoal  > 0 && gValorToday >= dailyGoal;
    const metaSemHit = weeklyGoal > 0 && gValorWeek  >= weeklyGoal;
    const convHit    = gToday.length > 0 && gPaidToday / gToday.length >= 0.25;
    const torcidaHit = withCorban.length >= 5 &&
      withCorban.every(m => parseInt(vendorMap[String(m.corban_id)]?.qtd_propostas || 0) > 10);
    const refBatches = Math.floor(gRefAll / 5);

    // --- Regras competitivas diárias: comparar apenas propostas de HOJE entre grupos ---
    let globalMaxContractToday = 0;
    let globalMaxPaidToday     = 0;
    allGroupsRows.forEach(g => {
      const cids      = (g.corban_ids || []).map(String);
      const gTodayAll  = globalProposals.filter(p =>
        cids.includes(String(p.vendedor_id)) && (p.datas?.cadastro || '').startsWith(todayStr)
      );
      const gPaidToday = gTodayAll.filter(p => p.datas?.pagamento);
      const mx   = gPaidToday.reduce((m, p) => Math.max(m, parseFloat(p.proposta?.valor_referencia || 0)), 0);
      const paid = gPaidToday.length;
      if (mx   > globalMaxContractToday) globalMaxContractToday = mx;
      if (paid > globalMaxPaidToday)     globalMaxPaidToday     = paid;
    });
    const golDePlacaHit = globalMaxContractToday > 0 && gMaxContractToday === globalMaxContractToday;
    const artilheiroHit = globalMaxPaidToday > 0 && gPaidToday === globalMaxPaidToday;

    // --- Pontos do time calculados das propostas (sem score_events) ---
    const teamPoints = {
      META_DIA:           metaDiaHit      ? 5  * multiplier : 0,
      META_SEMANA:        metaSemHit      ? 10 * multiplier : 0,
      CONVERSAO:          convHit         ? 5  * multiplier : 0,
      INDICACAO:          refBatches * 10 * multiplier,
      CONTRATO_10K:       gHVAll * 5 * multiplier,
      GOL_DE_PLACA:       golDePlacaHit   ? 15 * multiplier : 0,
      TORCIDA_ORGANIZADA: torcidaHit      ? 20 * multiplier : 0,
      ARTILHEIRO:         artilheiroHit   ? 15 * multiplier : 0,
    };

    // --- Métricas por membro (proporção) ---
    const metrics = members.map(m => {
      const cid = m.corban_id ? String(m.corban_id) : null;
      const mToday  = cid ? todayProps.filter(p => String(p.vendedor_id) === cid)  : [];
      const mWeekly = cid ? weeklyProps.filter(p => String(p.vendedor_id) === cid) : [];
      const mAll    = cid ? allProposals.filter(p => String(p.vendedor_id) === cid): [];
      return {
        cid,
        mValorToday:        sumVR(mToday.filter(p => p.datas?.pagamento)),
        mValorWeek:         sumVR(mWeekly),
        mPaidToday:         mToday.filter(p => p.datas?.pagamento).length,
        mPaidAll:           mAll.filter(p => p.datas?.pagamento).length,
        mRefAll:            mAll.filter(p => p.datas?.pagamento && p.proposta?.indicacao_id != null).length,
        mHVCount:           mAll.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000).length,
        mMaxContractToday:  mToday.filter(p => p.datas?.pagamento).reduce((mx, p) => Math.max(mx, parseFloat(p.proposta?.valor_referencia || 0)), 0),
        mQtdToday:          cid ? parseInt(vendorMap[cid]?.qtd_propostas || 0) : 0,
      };
    });

    function distribute(weights, totalPts) {
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum === 0) return weights.map(() => round2(totalPts / Math.max(members.length, 1)));
      return weights.map(w => round2((w / sum) * totalPts));
    }

    const RULE_META = {
      META_DIA:           { label: 'Meta do Dia',          icon: '🎯' },
      META_SEMANA:        { label: 'Meta da Semana',        icon: '📅' },
      CONVERSAO:          { label: 'Conversão de Vendas',   icon: '🔄' },
      INDICACAO:          { label: 'Vendas por Indicação',  icon: '👥' },
      CONTRATO_10K:       { label: 'Contrato Acima de 10K', icon: '💰' },
      GOL_DE_PLACA:       { label: 'Gol de Placa',          icon: '⚽' },
      TORCIDA_ORGANIZADA: { label: 'Torcida Organizada',    icon: '🎉' },
      ARTILHEIRO:         { label: 'Artilheiro da Rodada',  icon: '🏆' },
    };

    const memberRules  = members.map(() => []);
    const memberTotals = members.map(() => 0);

    for (const [ruleName, totalPts] of Object.entries(teamPoints)) {
      if (totalPts <= 0) continue;
      const meta = RULE_META[ruleName];
      if (!meta) continue;

      let weights, details;
      switch (ruleName) {
        case 'META_DIA':
          weights = metrics.map(m => m.mValorToday);
          details = metrics.map(m => `${fmtBRL(m.mValorToday)} de ${fmtBRL(gValorToday)} do grupo hoje`);
          break;
        case 'META_SEMANA':
          weights = metrics.map(m => m.mValorWeek);
          details = metrics.map(m => `${fmtBRL(m.mValorWeek)} de ${fmtBRL(gValorWeek)} da semana`);
          break;
        case 'CONVERSAO':
          weights = metrics.map(m => m.mPaidToday);
          details = metrics.map(m => `${m.mPaidToday} de ${gPaidToday} pagos hoje`);
          break;
        case 'INDICACAO':
          weights = metrics.map(m => m.mRefAll);
          details = metrics.map(m => `${m.mRefAll} contratos pagos por indicação`);
          break;
        case 'CONTRATO_10K':
          weights = metrics.map(m => m.mHVCount);
          details = metrics.map(m => `${m.mHVCount} contrato(s) acima de R$ 10.000`);
          break;
        case 'GOL_DE_PLACA':
          weights = metrics.map(m => m.mMaxContractToday === gMaxContractToday && gMaxContractToday > 0 ? 1 : 0);
          details = metrics.map(m => `Maior contrato hoje: ${fmtBRL(m.mMaxContractToday)}`);
          break;
        case 'TORCIDA_ORGANIZADA':
          weights = metrics.map(() => 1);
          details = metrics.map(m => `${m.mQtdToday} propostas hoje`);
          break;
        case 'ARTILHEIRO':
          weights = metrics.map(m => m.mPaidToday);
          details = metrics.map(m => `${m.mPaidToday} de ${gPaidToday} pagos hoje`);
          break;
        default:
          weights = metrics.map(() => 1);
          details = metrics.map(() => '');
      }

      const pts    = distribute(weights, totalPts);
      const totalW = weights.reduce((a, b) => a + b, 0);

      members.forEach((_, i) => {
        if (pts[i] <= 0) return;
        memberRules[i].push({
          rule_name: ruleName,
          label: meta.label,
          icon: meta.icon,
          points: pts[i],
          share_pct: totalW > 0 ? Math.round((weights[i] / totalW) * 100) : Math.round(100 / members.length),
          detail: details[i],
        });
        memberTotals[i] = round2(memberTotals[i] + pts[i]);
      });
    }

    const result = members.map((m, i) => ({
      id: m.id,
      display_name: m.display_name,
      corban_id: m.corban_id || null,
      is_captain: m.is_captain,
      total_points: memberTotals[i],
      rules: memberRules[i],
    }));

    result.sort((a, b) => b.total_points - a.total_points);

    const teamTotal = round2(Object.values(teamPoints).reduce((s, v) => s + v, 0));

    // Breakdown do grupo: cada regra com a atribuição (time todo ou membro específico)
    const breakdown = [];
    for (const [ruleName, totalPts] of Object.entries(teamPoints)) {
      if (totalPts <= 0) continue;
      const meta = RULE_META[ruleName];
      if (!meta) continue;

      let attribution = 'Time todo';
      let detail = '';

      switch (ruleName) {
        case 'META_DIA':
          attribution = 'Time todo';
          detail = `${fmtBRL(gValorToday)} / Meta ${fmtBRL(dailyGoal)}`;
          break;
        case 'META_SEMANA':
          attribution = 'Time todo';
          detail = `${fmtBRL(gValorWeek)} / Meta ${fmtBRL(weeklyGoal)}`;
          break;
        case 'CONVERSAO': {
          const rate = gToday.length > 0 ? Math.round(gPaidToday / gToday.length * 100) : 0;
          attribution = 'Time todo';
          detail = `${gPaidToday} de ${gToday.length} propostas pagas (${rate}% de conversão)`;
          break;
        }
        case 'INDICACAO': {
          const contribs = [];
          metrics.forEach((m, i) => { if (m.mRefAll > 0) contribs.push(`${members[i].display_name} (${m.mRefAll})`); });
          attribution = contribs.length > 0 ? contribs.join(', ') : 'Time todo';
          detail = `${gRefAll} indicações · ${refBatches} lote(s) de 5`;
          break;
        }
        case 'CONTRATO_10K': {
          const contribs = [];
          metrics.forEach((m, i) => { if (m.mHVCount > 0) contribs.push(`${members[i].display_name} (${m.mHVCount})`); });
          attribution = contribs.length > 0 ? contribs.join(', ') : 'Time todo';
          detail = `${gHVAll} contrato(s) acima de R$ 10.000`;
          break;
        }
        case 'GOL_DE_PLACA': {
          const wi = metrics.findIndex(m => m.mMaxContractToday === gMaxContractToday && gMaxContractToday > 0);
          attribution = wi >= 0 ? members[wi].display_name : 'Time todo';
          detail = `Maior contrato hoje: ${fmtBRL(gMaxContractToday)}`;
          break;
        }
        case 'TORCIDA_ORGANIZADA':
          attribution = 'Time todo';
          detail = `Todos os ${withCorban.length} membros com mais de 10 propostas hoje`;
          break;
        case 'ARTILHEIRO': {
          const topPaid = Math.max(...metrics.map(m => m.mPaidToday), 0);
          const winners = [];
          metrics.forEach((m, i) => { if (m.mPaidToday === topPaid && topPaid > 0) winners.push(members[i].display_name); });
          attribution = winners.length > 0 ? winners.join(', ') : 'Time todo';
          detail = `${gPaidToday} pagos hoje`;
          break;
        }
        default:
          attribution = 'Time todo';
      }

      breakdown.push({ rule_name: ruleName, label: meta.label, icon: meta.icon, points: totalPts, attribution, detail });
    }

    const team_stats = {
      daily_goal:       dailyGoal,
      weekly_goal:      weeklyGoal,
      valor_today:      gValorToday,
      valor_week:       gValorWeek,
      paid_today:       gPaidToday,
      total_today:      gToday.length,
      conversion_rate:  gToday.length > 0 ? round2(gPaidToday / gToday.length) : 0,
      paid_all:         gPaidAll,
      high_value_count: gHVAll,
      referrals_count:  gRefAll,
      max_contract_today: gMaxContractToday,
      total_points:       teamTotal,
      rules: {
        META_DIA:           { hit: metaDiaHit,    current: gValorToday, goal: dailyGoal },
        META_SEMANA:        { hit: metaSemHit,    current: gValorWeek,  goal: weeklyGoal },
        CONVERSAO:          { hit: convHit,       rate: gToday.length > 0 ? round2(gPaidToday / gToday.length) : 0, paid: gPaidToday, total: gToday.length },
        CONTRATO_10K:       { hit: gHVAll > 0,    count: gHVAll },
        INDICACAO:          { hit: gRefAll >= 5,  count: gRefAll },
        GOL_DE_PLACA:       { hit: golDePlacaHit, max_contract: gMaxContractToday },
        ARTILHEIRO:         { hit: artilheiroHit, paid_today: gPaidToday },
        TORCIDA_ORGANIZADA: { hit: torcidaHit },
      },
    };

    res.json({ group, team_stats, breakdown, members: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular pontos individuais' });
  }
});

// GET /api/groups/:id/members/stats — contribuição individual dos membros
router.get('/:id/members/stats', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const date = req.query.date || new Date().toISOString().split('T')[0];

  try {
    // Grupo
    const { rows: groupRows } = await db.query(
      'SELECT id, name, photo_url FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (groupRows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });

    // Membros com corban_id
    const { rows: members } = await db.query(
      `SELECT u.id, u.display_name, u.corban_id, gm.is_captain
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true`,
      [id]
    );

    const withCorban = members.filter(m => m.corban_id);
    const corbanIds  = withCorban.map(m => String(m.corban_id));

    // Buscar dados externos (com fallback se NewCorban não responder)
    const externalApi = require('../services/externalApi');
    let vendorMap   = {};
    let allProposals = [];

    if (corbanIds.length > 0) {
      try {
        const rankingData = await externalApi.getRanking(date, date);
        if (rankingData?.result) {
          Object.values(rankingData.result).forEach(v => {
            if (v.filter_value) vendorMap[String(v.filter_value)] = v;
          });
        }
      } catch (_) {}

      try {
        const proposalsData = await externalApi.getProposals(date, date, corbanIds);
        allProposals = proposalsData ? Object.values(proposalsData) : [];
      } catch (_) {}
    }

    // Stats por membro
    const memberStats = members.map(m => {
      const cid    = m.corban_id ? String(m.corban_id) : null;
      const vendor = cid ? (vendorMap[cid] || {}) : {};
      const mProps = cid ? allProposals.filter(p => String(p.vendedor_id) === cid) : [];
      const paid   = mProps.filter(p => p.datas?.pagamento);
      const valor  = mProps.reduce((s, p) => s + parseFloat(p.proposta?.valor_referencia || 0), 0);

      return {
        id:              m.id,
        display_name:    m.display_name,
        corban_id:       m.corban_id || null,
        is_captain:      m.is_captain,
        qtd_propostas:   parseInt(vendor.qtd_propostas || 0),
        valor_referencia: parseFloat(valor.toFixed(2)),
        contratos_pagos: paid.length,
      };
    });

    // Ordenar por valor_referencia desc
    memberStats.sort((a, b) => b.valor_referencia - a.valor_referencia);

    const totals = memberStats.reduce((acc, m) => ({
      qtd_propostas:    acc.qtd_propostas    + m.qtd_propostas,
      valor_referencia: acc.valor_referencia + m.valor_referencia,
      contratos_pagos:  acc.contratos_pagos  + m.contratos_pagos,
    }), { qtd_propostas: 0, valor_referencia: 0, contratos_pagos: 0 });

    res.json({ group: groupRows[0], date, members: memberStats, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar stats dos membros' });
  }
});

// GET /api/groups/:id - detalhes do grupo
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: groupRows } = await db.query(
      'SELECT * FROM groups WHERE id = $1 AND active = true',
      [id]
    );
    if (groupRows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });

    const group = groupRows[0];

    // Membros
    const { rows: members } = await db.query(
      `SELECT u.id, u.username, u.display_name, u.corban_id, u.corban_name, gm.is_captain, gm.joined_at
       FROM group_memberships gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND u.active = true`,
      [id]
    );

    // Pontuação total e hoje
    const { rows: scoreRows } = await db.query(
      `SELECT
        COALESCE(SUM(points), 0) as total_points,
        COALESCE(SUM(CASE WHEN event_date = CURRENT_DATE THEN points ELSE 0 END), 0) as today_points,
        COALESCE(SUM(CASE WHEN event_date >= date_trunc('week', CURRENT_DATE) THEN points ELSE 0 END), 0) as week_points
       FROM score_events WHERE group_id = $1`,
      [id]
    );

    const { rows: adjRows } = await db.query(
      `SELECT COALESCE(SUM(points), 0) as adj_total FROM point_adjustments WHERE group_id = $1`,
      [id]
    );

    // Histórico de eventos recentes
    const { rows: events } = await db.query(
      `SELECT * FROM score_events WHERE group_id = $1 ORDER BY event_date DESC, created_at DESC LIMIT 30`,
      [id]
    );

    // Ajustes manuais recentes
    const { rows: adjustments } = await db.query(
      `SELECT pa.*, u.display_name as admin_name
       FROM point_adjustments pa
       JOIN users u ON pa.admin_id = u.id
       WHERE pa.group_id = $1
       ORDER BY pa.created_at DESC LIMIT 10`,
      [id]
    );

    // Meta atual
    const { rows: goalRows } = await db.query(
      `SELECT * FROM group_goals
       WHERE group_id = $1 AND valid_from <= CURRENT_DATE AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );

    const score = scoreRows[0];
    const totalPoints = parseFloat(score.total_points) + parseFloat(adjRows[0].adj_total);

    res.json({
      ...group,
      members,
      score: {
        total: totalPoints,
        today: parseFloat(score.today_points),
        week: parseFloat(score.week_points),
      },
      events,
      adjustments,
      goal: goalRows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar grupo' });
  }
});

// POST /api/groups - criar grupo (jogador)
router.post('/', authMiddleware, upload.single('photo'), async (req, res) => {
  const { name } = req.body;

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: 'Nome do grupo deve ter pelo menos 2 caracteres' });
  }

  try {
    // Verificar se jogador já está em um grupo
    if (req.user.role === 'player') {
      const { rows: existing } = await db.query(
        'SELECT id FROM group_memberships WHERE user_id = $1',
        [req.user.id]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Você já pertence a um grupo' });
      }
    }

    const photoUrl = req.file
      ? `/uploads/groups/${req.file.filename}`
      : null;

    const { rows } = await db.query(
      'INSERT INTO groups (name, photo_url, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), photoUrl, req.user.id]
    );

    const group = rows[0];

    // Adicionar criador como membro capitão (se for jogador)
    if (req.user.role === 'player') {
      await db.query(
        'INSERT INTO group_memberships (user_id, group_id, is_captain) VALUES ($1, $2, true)',
        [req.user.id, group.id]
      );
    }

    res.status(201).json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar grupo' });
  }
});

// POST /api/groups/:id/join - entrar em um grupo
router.post('/:id/join', authMiddleware, async (req, res) => {
  if (req.user.role !== 'player') {
    return res.status(403).json({ error: 'Apenas jogadores podem entrar em grupos' });
  }

  try {
    const { id } = req.params;

    // Verificar se já está em um grupo
    const { rows: existing } = await db.query(
      'SELECT id FROM group_memberships WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Você já pertence a um grupo' });
    }

    // Verificar se grupo existe e tem vagas
    const { rows: groupRows } = await db.query(
      `SELECT g.id, COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN group_memberships gm ON g.id = gm.group_id
       WHERE g.id = $1 AND g.active = true
       GROUP BY g.id`,
      [id]
    );

    if (groupRows.length === 0) return res.status(404).json({ error: 'Grupo não encontrado' });

    if (parseInt(groupRows[0].member_count) >= 5) {
      return res.status(400).json({ error: 'Grupo está cheio (máximo 5 jogadores)' });
    }

    await db.query(
      'INSERT INTO group_memberships (user_id, group_id, is_captain) VALUES ($1, $2, false)',
      [req.user.id, id]
    );

    res.json({ message: 'Entrou no grupo com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao entrar no grupo' });
  }
});

// POST /api/groups/:id/leave - sair do grupo
router.post('/:id/leave', authMiddleware, async (req, res) => {
  if (req.user.role !== 'player') {
    return res.status(403).json({ error: 'Apenas jogadores podem sair de grupos' });
  }

  try {
    const { id } = req.params;
    await db.query(
      'DELETE FROM group_memberships WHERE user_id = $1 AND group_id = $2',
      [req.user.id, id]
    );
    res.json({ message: 'Saiu do grupo com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao sair do grupo' });
  }
});

// PUT /api/groups/:id - atualizar grupo
router.put('/:id', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    // Verificar se o usuário é capitão do grupo ou admin
    if (req.user.role !== 'admin') {
      const { rows } = await db.query(
        'SELECT id FROM group_memberships WHERE user_id = $1 AND group_id = $2 AND is_captain = true',
        [req.user.id, id]
      );
      if (rows.length === 0) {
        return res.status(403).json({ error: 'Apenas o capitão pode editar o grupo' });
      }
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (name) { updates.push(`name = $${paramIdx++}`); values.push(name.trim()); }
    if (req.file) { updates.push(`photo_url = $${paramIdx++}`); values.push(`/uploads/groups/${req.file.filename}`); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    values.push(id);
    const { rows } = await db.query(
      `UPDATE groups SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar grupo' });
  }
});

module.exports = router;
