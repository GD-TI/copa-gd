const db = require('../config/db');
const externalApi = require('./externalApi');

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // segunda-feira
  return new Date(d.setDate(diff));
}

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function sumValorRef(proposals) {
  return proposals.reduce((sum, p) => sum + parseFloat(p.proposta?.valor_referencia || 0), 0);
}

async function calculateScores(triggeredBy = null) {
  const today = new Date();
  const dateStr = toDateStr(today);
  const weekStart = getWeekStart(today);
  const weekStartStr = toDateStr(weekStart);

  console.log(`[Scoring] Calculando pontuações para ${dateStr}...`);

  // ---- 1. Buscar grupos, membros e metas em R$ ----
  const { rows: groups } = await db.query(`
    SELECT
      g.id, g.name,
      g.daily_goal_value, g.weekly_goal_value,
      COUNT(DISTINCT gm.user_id) as member_count,
      ARRAY_AGG(u.corban_id) FILTER (WHERE u.corban_id IS NOT NULL) as corban_ids,
      JSON_AGG(json_build_object(
        'id', u.id,
        'corban_id', u.corban_id,
        'display_name', u.display_name
      )) FILTER (WHERE u.corban_id IS NOT NULL) as members
    FROM groups g
    JOIN group_memberships gm ON g.id = gm.group_id
    JOIN users u ON gm.user_id = u.id
    WHERE g.active = true AND u.active = true
    GROUP BY g.id, g.name, g.daily_goal_value, g.weekly_goal_value
  `);

  if (groups.length === 0) {
    console.log('[Scoring] Nenhum grupo ativo encontrado.');
    return [];
  }

  const allCorbanIds = [...new Set(groups.flatMap(g => g.corban_ids || []))];
  if (allCorbanIds.length === 0) {
    console.log('[Scoring] Nenhum corban_id configurado nos jogadores.');
    return [];
  }

  // ---- 2. Buscar período da campanha ----
  const { rows: campRows } = await db.query(
    'SELECT start_date, end_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
  );
  const campaignStart = campRows[0]
    ? toDateStr(new Date(campRows[0].start_date))
    : weekStartStr;

  // ---- 3. Verificar dia de jogo do Brasil ----
  const { rows: matchRows } = await db.query(
    'SELECT id FROM brazil_matches WHERE match_date = $1 AND double_points = true',
    [dateStr]
  );
  const isMatchDay = matchRows.length > 0;
  const multiplier = isMatchDay ? 2 : 1;
  if (isMatchDay) console.log(`[Scoring] 🇧🇷 Dia de jogo do Brasil! Pontos em dobro.`);

  // ---- 4. Buscar dados do NewCorban ----
  let rankingData = null;
  let proposalsData = null;

  try {
    rankingData = await externalApi.getRanking(dateStr, dateStr);
    console.log(`[Scoring] Ranking diário carregado.`);
  } catch (err) {
    console.error('[Scoring] Falha ao buscar ranking:', err.message);
  }

  try {
    // Busca todas as propostas desde o início da campanha
    proposalsData = await externalApi.getProposals(campaignStart, dateStr, allCorbanIds);
    console.log(`[Scoring] ${Object.keys(proposalsData || {}).length} propostas carregadas (${campaignStart}→${dateStr})`);
  } catch (err) {
    console.error('[Scoring] Falha ao buscar propostas:', err.message);
  }

  // ---- 5. Listas de propostas por janela temporal ----
  const allProposals = proposalsData ? Object.values(proposalsData) : [];

  // Hoje (META_DIA, CONVERSAO, TORCIDA_ORGANIZADA): cadastro no dia atual
  const todayProposals = allProposals.filter(p =>
    (p.datas?.cadastro || p.datas?.inclusao || '').startsWith(dateStr)
  );

  // Semana (META_SEMANA): cadastro a partir da segunda-feira desta semana
  const weeklyProposals = allProposals.filter(p =>
    (p.datas?.cadastro || p.datas?.inclusao || '') >= weekStartStr
  );

  // ---- 6. Mapa de qtd_propostas por vendedor (ranking diário) ----
  const vendorByCorbanId = {};
  if (rankingData?.result) {
    Object.values(rankingData.result).forEach(vendor => {
      if (vendor.filter_value) {
        vendorByCorbanId[String(vendor.filter_value)] = vendor;
      }
    });
  }

  // ---- 7. Calcular dados por grupo ----
  const groupData = {};

  for (const group of groups) {
    const corbanIds = (group.corban_ids || []).map(String);
    if (corbanIds.length === 0) continue;

    // Qtd propostas hoje (do ranking — para TORCIDA_ORGANIZADA)
    let totalQtdToday = 0;
    const memberQtdMap = {};
    corbanIds.forEach(cid => {
      const qty = vendorByCorbanId[cid]?.qtd_propostas || 0;
      totalQtdToday += qty;
      memberQtdMap[cid] = qty;
    });

    // Propostas de hoje (META_DIA, CONVERSAO)
    const gToday = todayProposals.filter(p => corbanIds.includes(String(p.vendedor_id)));
    const paidToday = gToday.filter(p => p.datas?.pagamento);
    const valorRefToday = sumValorRef(paidToday);
    const conversionRate = gToday.length > 0 ? paidToday.length / gToday.length : 0;

    // Propostas da semana (META_SEMANA)
    const gWeekly = weeklyProposals.filter(p => corbanIds.includes(String(p.vendedor_id)));
    const valorRefWeek = sumValorRef(gWeekly);

    // Todas as propostas do período da campanha (regras acumuladas)
    const gAll = allProposals.filter(p => corbanIds.includes(String(p.vendedor_id)));
    const paidAll = gAll.filter(p => p.datas?.pagamento);
    const paidReferralsAll = paidAll.filter(p => p.proposta?.indicacao_id != null);
    const highValueAll = gAll.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000);

    // Diário — para regras competitivas (GOL_DE_PLACA, ARTILHEIRO)
    // GOL_DE_PLACA: maior contrato PAGO hoje
    const maxContractToday = paidToday.reduce((max, p) =>
      Math.max(max, parseFloat(p.proposta?.valor_referencia || 0)), 0
    );

    groupData[group.id] = {
      group,
      corbanIds,
      memberCount: parseInt(group.member_count),
      memberQtdMap,
      // diário
      totalQtdToday,
      valorRefToday,
      conversionRate,
      todayCount: gToday.length,
      paidTodayCount: paidToday.length,
      maxContractToday,
      // semanal
      valorRefWeek,
      // campanha acumulada
      paidAllCount: paidAll.length,
      paidReferralsAll,
      highValueAll,
    };
  }

  // ---- 8. Regras competitivas diárias (inter-grupos, por dia) ----

  // GOL DE PLACA: grupo cujo jogador tem o maior contrato registrado HOJE
  let globalMaxContractToday = 0;
  Object.values(groupData).forEach(d => {
    if (d.maxContractToday > globalMaxContractToday) globalMaxContractToday = d.maxContractToday;
  });
  const golDePlacaGroupIds = globalMaxContractToday > 0
    ? Object.entries(groupData)
        .filter(([, d]) => d.maxContractToday === globalMaxContractToday)
        .map(([id]) => parseInt(id))
    : [];

  // ARTILHEIRO DA RODADA: grupo com mais contratos pagos HOJE
  let globalMaxPaidToday = 0;
  Object.values(groupData).forEach(d => {
    if (d.paidTodayCount > globalMaxPaidToday) globalMaxPaidToday = d.paidTodayCount;
  });
  const artilheiroGroupIds = globalMaxPaidToday > 0
    ? Object.entries(groupData)
        .filter(([, d]) => d.paidTodayCount === globalMaxPaidToday)
        .map(([id]) => parseInt(id))
    : [];

  // ---- 9. Gerar eventos de pontuação ----
  const events = [];

  for (const [groupIdStr, data] of Object.entries(groupData)) {
    const groupId = parseInt(groupIdStr);
    const dailyGoal  = parseFloat(data.group.daily_goal_value  || 0);
    const weeklyGoal = parseFloat(data.group.weekly_goal_value || 0);

    // ── META DO DIA: valor_referencia de hoje >= meta diária
    //    event_date = hoje (repete por dia que a meta for batida)
    if (dailyGoal > 0 && data.valorRefToday >= dailyGoal) {
      events.push({
        group_id: groupId,
        event_date: dateStr,
        rule_name: 'META_DIA',
        points: 5 * multiplier,
        description: `Meta diária atingida: R$ ${data.valorRefToday.toFixed(2)} pagos / meta R$ ${dailyGoal.toFixed(2)}`,
      });
    }

    // ── CONVERSÃO DE VENDAS: taxa de conversão de hoje >= 25%
    //    event_date = hoje
    if (data.todayCount > 0 && data.conversionRate >= 0.25) {
      events.push({
        group_id: groupId,
        event_date: dateStr,
        rule_name: 'CONVERSAO',
        points: 5 * multiplier,
        description: `Conversão de ${Math.round(data.conversionRate * 100)}%: ${Math.round(data.conversionRate * data.todayCount)}/${data.todayCount} contratos pagos hoje`,
      });
    }

    // ── META DA SEMANA: valor_referencia desta semana >= meta semanal
    //    event_date = início da semana (uma entrada por semana)
    if (weeklyGoal > 0 && data.valorRefWeek >= weeklyGoal) {
      events.push({
        group_id: groupId,
        event_date: weekStartStr >= campaignStart ? weekStartStr : campaignStart,
        rule_name: 'META_SEMANA',
        points: 10 * multiplier,
        description: `Meta semanal atingida: R$ ${data.valorRefWeek.toFixed(2)} / meta R$ ${weeklyGoal.toFixed(2)} (${weekStartStr}–${dateStr})`,
      });
    }

    // ── VENDAS POR INDICAÇÃO: a cada 5 contratos pagos por indicação = 10 pts (campanha)
    //    event_date = início da campanha (atualiza acumulado)
    const referralBatches = Math.floor(data.paidReferralsAll.length / 5);
    if (referralBatches > 0) {
      events.push({
        group_id: groupId,
        event_date: campaignStart,
        rule_name: 'INDICACAO',
        points: referralBatches * 10 * multiplier,
        description: `${data.paidReferralsAll.length} contratos pagos por indicação (${referralBatches}× 10 pts)`,
      });
    }

    // ── CONTRATO ACIMA DE 10K: 5 pts por contrato (campanha acumulada)
    //    event_date = início da campanha
    if (data.highValueAll.length > 0) {
      events.push({
        group_id: groupId,
        event_date: campaignStart,
        rule_name: 'CONTRATO_10K',
        points: data.highValueAll.length * 5 * multiplier,
        description: `${data.highValueAll.length} contrato(s) acima de R$ 10.000`,
      });
    }

    // ── GOL DE PLACA: grupo cujo jogador tem o maior contrato HOJE
    //    event_date = hoje (prêmio diário, acumula a cada dia vencido)
    if (golDePlacaGroupIds.includes(groupId)) {
      events.push({
        group_id: groupId,
        event_date: dateStr,
        rule_name: 'GOL_DE_PLACA',
        points: 15 * multiplier,
        description: `Maior contrato do dia: R$ ${globalMaxContractToday.toFixed(2)}`,
      });
    }

    // ── TORCIDA ORGANIZADA: todos os 5 membros com > 10 propostas hoje
    //    event_date = hoje (ranking diário)
    if (data.memberCount >= 5) {
      const membersAbove10 = data.corbanIds.filter(cid => (data.memberQtdMap[cid] || 0) > 10);
      if (membersAbove10.length >= 5) {
        events.push({
          group_id: groupId,
          event_date: dateStr,
          rule_name: 'TORCIDA_ORGANIZADA',
          points: 20 * multiplier,
          description: `Todos os 5 integrantes fecharam mais de 10 propostas hoje`,
        });
      }
    }

    // ── ARTILHEIRO DA RODADA: grupo com mais contratos pagos HOJE
    //    event_date = hoje (prêmio diário, acumula a cada dia vencido)
    if (artilheiroGroupIds.includes(groupId)) {
      events.push({
        group_id: groupId,
        event_date: dateStr,
        rule_name: 'ARTILHEIRO',
        points: 15 * multiplier,
        description: `Maior número de contratos pagos hoje: ${globalMaxPaidToday}`,
      });
    }
  }

  // ---- 10. Persistir eventos (idempotente) ----
  // Para regras competitivas diárias, remove eventos de hoje de grupos que
  // perderam o topo durante o dia (pode ocorrer entre rodadas de 15 min).
  if (golDePlacaGroupIds.length > 0) {
    await db.query(
      `DELETE FROM score_events
       WHERE rule_name = 'GOL_DE_PLACA' AND event_date = $1
         AND group_id <> ALL($2::int[])`,
      [dateStr, golDePlacaGroupIds]
    );
  }
  if (artilheiroGroupIds.length > 0) {
    await db.query(
      `DELETE FROM score_events
       WHERE rule_name = 'ARTILHEIRO' AND event_date = $1
         AND group_id <> ALL($2::int[])`,
      [dateStr, artilheiroGroupIds]
    );
  }

  for (const event of events) {
    try {
      await db.query(
        `INSERT INTO score_events (group_id, event_date, rule_name, points, description, is_double_points)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (group_id, event_date, rule_name) DO UPDATE
           SET points = EXCLUDED.points,
               description = EXCLUDED.description,
               is_double_points = EXCLUDED.is_double_points`,
        [event.group_id, event.event_date, event.rule_name, event.points, event.description, isMatchDay]
      );
    } catch (err) {
      console.error(`[Scoring] Erro ao salvar ${event.rule_name} grupo ${event.group_id}:`, err.message);
    }
  }

  await db.query(
    `INSERT INTO daily_calculations (calculation_date, triggered_by)
     VALUES ($1, $2)
     ON CONFLICT (calculation_date) DO UPDATE SET calculated_at = NOW(), triggered_by = $2`,
    [dateStr, triggeredBy]
  );

  console.log(`[Scoring] ✅ ${events.length} eventos gerados para ${dateStr}`);
  return events;
}

module.exports = { calculateScores };
