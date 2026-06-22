const db = require('../config/db');
const externalApi = require('./externalApi');
const { getRulePointsMap } = require('./scoringRules');
const { filterPaidIndicacoes } = require('../utils/proposals');

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d;
}

function getDaysInRange(startStr, endStr) {
  const days = [];
  let cur = new Date(startStr + 'T12:00:00Z');
  const end = new Date(endStr + 'T12:00:00Z');
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

function sumValorRef(proposals) {
  return proposals.reduce((s, p) => s + parseFloat(p.proposta?.valor_referencia || 0), 0);
}

async function upsertEvent(groupId, eventDate, ruleName, points, description, isDouble) {
  await db.query(
    `INSERT INTO score_events (group_id, event_date, rule_name, points, description, is_double_points)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (group_id, event_date, rule_name) DO UPDATE
       SET points = EXCLUDED.points,
           description = EXCLUDED.description,
           is_double_points = EXCLUDED.is_double_points`,
    [groupId, eventDate, ruleName, points, description, isDouble]
  );
}

async function deleteEvent(groupId, eventDate, ruleName) {
  await db.query(
    'DELETE FROM score_events WHERE group_id = $1 AND event_date = $2 AND rule_name = $3',
    [groupId, eventDate, ruleName]
  );
}

async function calculateScores(triggeredBy = null) {
  const todayStr = toDateStr(new Date());
  const isForce  = triggeredBy !== null; // admin = recalculate all; cron = skip processed past days

  console.log(`[Scoring] Calculando até ${todayStr} (force=${isForce})...`);

  // Campanha (precisa antes do wipe em modo force)
  const { rows: campRows } = await db.query(
    'SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1'
  );
  const campaignStart = campRows[0] ? toDateStr(new Date(campRows[0].start_date)) : todayStr;

  // Force (admin): apaga eventos e marcações de dias para recalcular toda a campanha
  if (isForce) {
    console.log('[Scoring] Force: recalculando campanha inteira (mudança de equipe/membro)...');
    await db.query(
      `DELETE FROM score_events
       WHERE group_id IN (SELECT id FROM groups WHERE active = true)
         AND event_date >= $1::date AND event_date <= $2::date`,
      [campaignStart, todayStr]
    );
    await db.query(
      `DELETE FROM daily_calculations
       WHERE calculation_date >= $1::date AND calculation_date <= $2::date`,
      [campaignStart, todayStr]
    );
  }

  // ── 1. Grupos e membros ──────────────────────────────────────────────────
  const { rows: groups } = await db.query(`
    SELECT
      g.id, g.name, g.daily_goal_value, g.weekly_goal_value,
      COUNT(DISTINCT gm.user_id)::int AS member_count,
      ARRAY_AGG(u.corban_id) FILTER (WHERE u.corban_id IS NOT NULL) AS corban_ids
    FROM groups g
    JOIN group_memberships gm ON g.id = gm.group_id
    JOIN users u ON gm.user_id = u.id
    WHERE g.active = true AND u.active = true
    GROUP BY g.id, g.name, g.daily_goal_value, g.weekly_goal_value
  `);

  if (groups.length === 0) {
    console.log('[Scoring] Nenhum grupo com membros ativos.');
    return [];
  }

  const rulePts = await getRulePointsMap();

  // Mapa corban_id → nome do consultor
  const { rows: corbanUsers } = await db.query(
    'SELECT corban_id, display_name FROM users WHERE corban_id IS NOT NULL AND active = true'
  );
  const corbanToName = {};
  corbanUsers.forEach(u => { corbanToName[String(u.corban_id)] = u.display_name; });

  const allCorbanIds = [...new Set(groups.flatMap(g => g.corban_ids || []))];
  if (allCorbanIds.length === 0) { console.log('[Scoring] Nenhum corban_id configurado.'); return []; }

  // ── 2. Ranking de hoje (TORCIDA_ORGANIZADA) ──────────────────────────────
  const vendorMap = {};
  try {
    const rd = await externalApi.getRanking(todayStr, todayStr);
    if (rd?.result) {
      Object.values(rd.result).forEach(v => {
        if (v.filter_value) vendorMap[String(v.filter_value)] = v;
      });
    }
  } catch (e) { console.error('[Scoring] Ranking error:', e.message); }

  // ── 4. Todas as propostas da campanha (uma chamada, cacheada) ─────────────
  let allProposals = [];
  try {
    const pd = await externalApi.getProposals(campaignStart, todayStr, allCorbanIds);
    allProposals = pd ? Object.values(pd) : [];
    console.log(`[Scoring] ${allProposals.length} propostas (${campaignStart}→${todayStr})`);
  } catch (e) { console.error('[Scoring] Proposals error:', e.message); }

  // ── 5. Dias com pontos em dobro ──────────────────────────────────────────
  const { rows: matchRows } = await db.query(
    `SELECT match_date FROM brazil_matches
     WHERE match_date BETWEEN $1 AND $2 AND double_points = true`,
    [campaignStart, todayStr]
  );
  const doubleDays = new Set(matchRows.map(m => toDateStr(new Date(m.match_date))));

  // ── 6. Dias passados já calculados (skip em modo cron) ───────────────────
  const processedDays = new Set();
  if (!isForce) {
    const { rows: dc } = await db.query(
      `SELECT calculation_date::text FROM daily_calculations
       WHERE calculation_date BETWEEN $1 AND $2`,
      [campaignStart, todayStr]
    );
    dc.forEach(r => processedDays.add(String(r.calculation_date).slice(0, 10)));
  }

  const campaignDays = getDaysInRange(campaignStart, todayStr);
  let totalEvents = [];

  // ── 7. Regras diárias: para cada dia da campanha ─────────────────────────
  for (const dateStr of campaignDays) {
    const isToday = dateStr === todayStr;

    // Dias passados já processados: pular (exceto em force)
    if (!isToday && processedDays.has(dateStr)) continue;

    const mult = doubleDays.has(dateStr) ? 2 : 1;

    // Propostas deste dia específico
    const dayProps = allProposals.filter(p =>
      (p.datas?.cadastro || p.datas?.inclusao || '').startsWith(dateStr)
    );

    // Estatísticas por grupo para este dia
    const gStats = {};
    for (const g of groups) {
      const cids  = (g.corban_ids || []).map(String);
      const gDay  = dayProps.filter(p => cids.includes(String(p.vendedor_id)));
      const gPaid = gDay.filter(p => p.datas?.pagamento);
      const gValor = sumValorRef(gPaid);
      const gMaxC  = gPaid.reduce((mx, p) => Math.max(mx, parseFloat(p.proposta?.valor_referencia || 0)), 0);
      gStats[g.id] = { cids, gDay, gPaid, gValor, gMaxC };
    }

    // Máximos globais para regras competitivas
    const globalMaxC = groups.reduce((mx, g) => Math.max(mx, gStats[g.id].gMaxC), 0);
    const globalMaxP = groups.reduce((mx, g) => Math.max(mx, gStats[g.id].gPaid.length), 0);
    const golWinners = globalMaxC > 0 ? groups.filter(g => gStats[g.id].gMaxC === globalMaxC).map(g => g.id) : [];
    const artWinners = globalMaxP > 0 ? groups.filter(g => gStats[g.id].gPaid.length === globalMaxP).map(g => g.id) : [];

    // Consultor que fez o maior contrato em cada grupo vencedor
    const golConsultor = {};
    for (const g of groups) {
      if (!golWinners.includes(g.id)) continue;
      const maxProp = gStats[g.id].gPaid.reduce((mx, p) => {
        return parseFloat(p.proposta?.valor_referencia || 0) >= parseFloat(mx?.proposta?.valor_referencia || 0) ? p : mx;
      }, gStats[g.id].gPaid[0] || null);
      if (maxProp) golConsultor[g.id] = corbanToName[String(maxProp.vendedor_id)] || null;
    }

    // Consultor com mais contratos pagos em cada grupo vencedor
    const artConsultor = {};
    for (const g of groups) {
      if (!artWinners.includes(g.id)) continue;
      const paidPerCid = {};
      gStats[g.id].gPaid.forEach(p => {
        const cid = String(p.vendedor_id);
        paidPerCid[cid] = (paidPerCid[cid] || 0) + 1;
      });
      const top = Object.entries(paidPerCid).sort(([, a], [, b]) => b - a)[0];
      if (top) artConsultor[g.id] = corbanToName[top[0]] || null;
    }

    // Hoje: limpar perdedores das regras competitivas (podem mudar durante o dia)
    if (isToday) {
      if (golWinners.length > 0) {
        await db.query(
          `DELETE FROM score_events WHERE rule_name='GOL_DE_PLACA' AND event_date=$1 AND group_id <> ALL($2::int[])`,
          [dateStr, golWinners]
        );
      }
      if (artWinners.length > 0) {
        await db.query(
          `DELETE FROM score_events WHERE rule_name='ARTILHEIRO' AND event_date=$1 AND group_id <> ALL($2::int[])`,
          [dateStr, artWinners]
        );
      }
    }

    const dayEvents = [];

    for (const g of groups) {
      const s = gStats[g.id];
      const dailyGoal = parseFloat(g.daily_goal_value || 0);

      // META_DIA: soma de valor_ref dos pagos hoje >= meta diária
      if (dailyGoal > 0 && s.gValor >= dailyGoal) {
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'META_DIA',
          points: rulePts.META_DIA * mult,
          description: `Meta diária: R$ ${s.gValor.toFixed(2)} pagos / meta R$ ${dailyGoal.toFixed(2)}`,
          is_double: mult > 1,
        });
      } else if (isToday) {
        await deleteEvent(g.id, dateStr, 'META_DIA');
      }

      // CONVERSAO: taxa de pagamento hoje >= 25%
      if (s.gDay.length > 0 && s.gPaid.length / s.gDay.length >= 0.25) {
        const rate = s.gPaid.length / s.gDay.length;
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'CONVERSAO',
          points: rulePts.CONVERSAO * mult,
          description: `Conversão ${Math.round(rate * 100)}%: ${s.gPaid.length}/${s.gDay.length} pagos`,
          is_double: mult > 1,
        });
      } else if (isToday) {
        await deleteEvent(g.id, dateStr, 'CONVERSAO');
      }

      // GOL_DE_PLACA: maior contrato pago do dia (competitivo)
      if (golWinners.includes(g.id)) {
        const consultor = golConsultor[g.id];
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'GOL_DE_PLACA',
          points: rulePts.GOL_DE_PLACA * mult,
          description: `Maior contrato do dia: R$ ${globalMaxC.toFixed(2)}${consultor ? ` · ${consultor}` : ''}`,
          is_double: mult > 1,
        });
      }

      // ARTILHEIRO: mais contratos pagos do dia (competitivo)
      if (artWinners.includes(g.id)) {
        const consultor = artConsultor[g.id];
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'ARTILHEIRO',
          points: rulePts.ARTILHEIRO * mult,
          description: `Artilheiro: ${globalMaxP} contratos pagos${consultor ? ` · líder: ${consultor}` : ''}`,
          is_double: mult > 1,
        });
      }

      // TORCIDA_ORGANIZADA: só hoje (depende do ranking em tempo real)
      if (isToday) {
        if (g.member_count >= 5 && s.cids.every(cid => (vendorMap[cid]?.qtd_propostas || 0) > 10)) {
          dayEvents.push({
            group_id: g.id, event_date: dateStr, rule_name: 'TORCIDA_ORGANIZADA',
            points: rulePts.TORCIDA_ORGANIZADA * mult,
            description: `Todos os ${g.member_count} integrantes com >10 propostas hoje`,
            is_double: mult > 1,
          });
        } else {
          await deleteEvent(g.id, dateStr, 'TORCIDA_ORGANIZADA');
        }
      }
    }

    for (const ev of dayEvents) {
      await upsertEvent(ev.group_id, ev.event_date, ev.rule_name, ev.points, ev.description, ev.is_double);
    }

    // Marcar dia passado como processado
    if (!isToday) {
      await db.query(
        `INSERT INTO daily_calculations (calculation_date, triggered_by)
         VALUES ($1, $2) ON CONFLICT (calculation_date) DO UPDATE SET calculated_at = NOW(), triggered_by = $2`,
        [dateStr, isForce ? triggeredBy : null]
      );
    }

    totalEvents = totalEvents.concat(dayEvents);
  }

  // ── 8. META_SEMANA: por semana da campanha ───────────────────────────────
  const weekStartsSet = new Set();
  campaignDays.forEach(d => {
    const ws = toDateStr(getWeekStart(new Date(d + 'T12:00:00Z')));
    weekStartsSet.add(ws < campaignStart ? campaignStart : ws);
  });

  for (const wsStr of weekStartsSet) {
    const wsDate = new Date(wsStr + 'T12:00:00Z');
    const weDate = new Date(wsDate.getTime() + 6 * 86400000);
    const weStr  = toDateStr(weDate) > todayStr ? todayStr : toDateStr(weDate);
    const isCurrentWeek = wsStr <= todayStr && todayStr <= weStr;

    // Para semanas passadas processadas: só recalcular em force
    if (!isCurrentWeek && !isForce && processedDays.has(wsStr)) continue;

    // Multiplier: dobro se algum dia da semana foi dia de jogo
    const weekMult = getDaysInRange(wsStr, weStr).some(d => doubleDays.has(d)) ? 2 : 1;

    const weekProps = allProposals.filter(p => {
      const d = p.datas?.cadastro || p.datas?.inclusao || '';
      return d >= wsStr && d <= weStr;
    });

    for (const g of groups) {
      const cids = (g.corban_ids || []).map(String);
      const gWeek = weekProps.filter(p => cids.includes(String(p.vendedor_id)));
      const gValorWeek = sumValorRef(gWeek);
      const weeklyGoal = parseFloat(g.weekly_goal_value || 0);

      if (weeklyGoal > 0 && gValorWeek >= weeklyGoal) {
        await upsertEvent(g.id, wsStr, 'META_SEMANA', rulePts.META_SEMANA * weekMult,
          `Meta semanal: R$ ${gValorWeek.toFixed(2)} / meta R$ ${weeklyGoal.toFixed(2)} (${wsStr}→${weStr})`,
          weekMult > 1);
      }
    }
  }

  // ── 9. INDICACAO + CONTRATO_10K: acumulado da campanha ──────────────────
  const todayMult = doubleDays.has(todayStr) ? 2 : 1;
  for (const g of groups) {
    const cids   = (g.corban_ids || []).map(String);
    const gAll   = allProposals.filter(p => cids.includes(String(p.vendedor_id)));
    const paidAll = gAll.filter(p => p.datas?.pagamento);

    const paidRefs = filterPaidIndicacoes(paidAll);
    const refBatches = Math.floor(paidRefs.length / 5);
    if (refBatches > 0) {
      await upsertEvent(
        g.id, campaignStart, 'INDICACAO',
        refBatches * rulePts.INDICACAO * todayMult,
        `${paidRefs.length} contrato(s) pagos com Indicação — ${refBatches} lote(s) de 5 × ${rulePts.INDICACAO} pts`,
        todayMult > 1
      );
    } else {
      await deleteEvent(g.id, campaignStart, 'INDICACAO');
    }

    const hvCount = paidAll.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000).length;
    if (hvCount > 0) {
      await upsertEvent(g.id, campaignStart, 'CONTRATO_10K', hvCount * rulePts.CONTRATO_10K * todayMult,
        `${hvCount} contrato(s) acima de R$ 10.000`, todayMult > 1);
    } else {
      await deleteEvent(g.id, campaignStart, 'CONTRATO_10K');
    }
  }

  // ── 10. Marcar hoje no daily_calculations ────────────────────────────────
  await db.query(
    `INSERT INTO daily_calculations (calculation_date, triggered_by)
     VALUES ($1, $2) ON CONFLICT (calculation_date) DO UPDATE SET calculated_at = NOW(), triggered_by = $2`,
    [todayStr, triggeredBy]
  );

  console.log(`[Scoring] ✅ ${totalEvents.length} eventos diários gerados`);
  return totalEvents;
}

module.exports = { calculateScores };
