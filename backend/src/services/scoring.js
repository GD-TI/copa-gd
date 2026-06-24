const db = require('../config/db');
const externalApi = require('./externalApi');
const { getRulePointsMap } = require('./scoringRules');
const { filterPaidIndicacoes } = require('../utils/proposals');
const {
  isBusinessDay,
  getCadastroDateStr,
  isWeekdayPaid,
  filterByWeekdayCadastro,
  getDaysInRange,
  getBusinessDaysInRange,
} = require('../utils/businessDays');

const CONVERSION_MIN_RATE = parseFloat(process.env.CONVERSION_MIN_RATE || '0.80');

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

/** Data PostgreSQL → YYYY-MM-DD sem shift de fuso. */
function pgDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d;
}

const DAILY_RULES = ['META_DIA', 'META_DIA_PLUS30', 'META_DIA_PLUS50', 'META_DIA_PLUS100', 'META_DIA_CLT', 'META_DIA_FGTS', 'CONVERSAO', 'GOL_DE_PLACA', 'ARTILHEIRO', 'TORCIDA_ORGANIZADA'];

function getProductoId(p) {
  return String(p.produto_id || p.proposta?.produto_id || '');
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

async function batchUpsertEvents(events) {
  if (events.length === 0) return;
  const values = events.map((_, i) => {
    const b = i * 6;
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
  }).join(',');
  const params = events.flatMap(ev => [
    ev.group_id, ev.event_date, ev.rule_name, ev.points, ev.description, ev.is_double || false,
  ]);
  await db.query(
    `INSERT INTO score_events (group_id, event_date, rule_name, points, description, is_double_points)
     VALUES ${values}
     ON CONFLICT (group_id, event_date, rule_name) DO UPDATE
       SET points = EXCLUDED.points,
           description = EXCLUDED.description,
           is_double_points = EXCLUDED.is_double_points`,
    params
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

  if (isForce) {
    console.log('[Scoring] Force: recalculando campanha inteira (mudança de equipe/membro)...');
    // Não apaga tudo de uma vez — limpa dia a dia no loop para evitar zeragem do ranking
  }

  // ── 1. Grupos e membros ──────────────────────────────────────────────────
  const { rows: groups } = await db.query(`
    SELECT
      g.id, g.name, g.daily_goal_value, g.weekly_goal_value,
      g.daily_goal_meta2, g.daily_goal_meta3, g.daily_goal_meta4,
      COUNT(DISTINCT gm.user_id)::int AS member_count,
      ARRAY_AGG(u.corban_id) FILTER (WHERE u.corban_id IS NOT NULL) AS corban_ids
    FROM groups g
    JOIN group_memberships gm ON g.id = gm.group_id
    JOIN users u ON gm.user_id = u.id
    WHERE g.active = true AND u.active = true
    GROUP BY g.id, g.name, g.daily_goal_value, g.weekly_goal_value,
             g.daily_goal_meta2, g.daily_goal_meta3, g.daily_goal_meta4
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
  let rankingOk = false;
  const vendorMap = {};
  try {
    const rd = await externalApi.getRanking(todayStr, todayStr);
    rankingOk = true; // API respondeu (pode ser vazio — válido)
    if (rd?.result) {
      Object.values(rd.result).forEach(v => {
        if (v.filter_value) vendorMap[String(v.filter_value)] = v;
      });
    }
  } catch (e) { console.error('[Scoring] Ranking error:', e.message); }

  // ── 4. Todas as propostas da campanha (uma chamada, cacheada) ─────────────
  let allProposals = [];
  let proposalsOk = false;
  try {
    const pd = await externalApi.getProposals(campaignStart, todayStr, allCorbanIds);
    allProposals = pd ? filterByWeekdayCadastro(Object.values(pd)) : [];
    proposalsOk = true;
    console.log(`[Scoring] ${allProposals.length} propostas em dias úteis (${campaignStart}→${todayStr})`);
  } catch (e) { console.error('[Scoring] Proposals error:', e.message); }

  if (!proposalsOk) {
    console.warn('[Scoring] ⚠️  API de propostas indisponível — rodada abortada para preservar pontuações');
    return [];
  }

  // ── 5. Dias com pontos em dobro ──────────────────────────────────────────
  const { rows: matchRows } = await db.query(
    `SELECT match_date FROM brazil_matches
     WHERE match_date BETWEEN $1 AND $2 AND double_points = true`,
    [campaignStart, todayStr]
  );
  const doubleDays = new Set(matchRows.map(m => pgDateStr(m.match_date)));
  if (doubleDays.size > 0) {
    console.log(`[Scoring] ${doubleDays.size} dia(s) com pontos em dobro (jogo do Brasil)`);
  }

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

  // Ranking histórico para TORCIDA em dias de jogo passados (recálculo retroativo) — em paralelo
  const vendorMapByDate = {};
  if (isForce && doubleDays.size > 0) {
    const retroDays = [...doubleDays].filter(d => isBusinessDay(d) && d !== todayStr);
    await Promise.all(retroDays.map(async (d) => {
      try {
        const rd = await externalApi.getRanking(d, d);
        const vm = {};
        if (rd?.result) {
          Object.values(rd.result).forEach(v => {
            if (v.filter_value) vm[String(v.filter_value)] = v;
          });
        }
        vendorMapByDate[d] = vm;
      } catch (e) {
        console.warn(`[Scoring] Ranking ${d} indisponível (TORCIDA retroativa):`, e.message);
      }
    }));
  }

  // ── 7. Regras diárias: para cada dia da campanha ─────────────────────────
  for (const dateStr of campaignDays) {
    const isToday = dateStr === todayStr;

    // Force: limpar eventos diários deste dia antes de recalcular (evita zeragem total do ranking)
    if (isForce) {
      await db.query(
        `DELETE FROM score_events WHERE event_date = $1::date AND rule_name = ANY($2::text[])`,
        [dateStr, DAILY_RULES]
      );
    }

    // Fins de semana não entram na campanha
    if (!isBusinessDay(dateStr)) {
      if (isToday && !isForce) {
        for (const g of groups) {
          for (const rule of DAILY_RULES) {
            await deleteEvent(g.id, dateStr, rule);
          }
        }
      }
      if (!isToday && !processedDays.has(dateStr)) {
        await db.query(
          `INSERT INTO daily_calculations (calculation_date, triggered_by)
           VALUES ($1, $2) ON CONFLICT (calculation_date) DO UPDATE SET calculated_at = NOW(), triggered_by = $2`,
          [dateStr, isForce ? triggeredBy : null]
        );
      }
      continue;
    }

    // Dias passados já processados: pular, exceto force ou dia de jogo do Brasil (retroativo)
    if (!isToday && !isForce && processedDays.has(dateStr) && !doubleDays.has(dateStr)) continue;

    const mult = doubleDays.has(dateStr) ? 2 : 1;
    const recalcDay = isToday || isForce || doubleDays.has(dateStr);

    // Propostas deste dia específico (cadastro em dia útil)
    const dayProps = allProposals.filter(p => getCadastroDateStr(p) === dateStr);

    // Estatísticas por grupo para este dia
    const gStats = {};
    for (const g of groups) {
      const cids  = (g.corban_ids || []).map(String);
      const gDay  = dayProps.filter(p => cids.includes(String(p.vendedor_id)));
      const gPaid = gDay.filter(isWeekdayPaid);
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

    // Limpar perdedores das regras competitivas (hoje ou recálculo retroativo de dia de jogo)
    if (recalcDay) {
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

        // Bônus por metas 2, 3 e 4 (thresholds fixos por equipe) — apenas o tier mais alto é concedido
        const meta4 = parseFloat(g.daily_goal_meta4 || 0);
        const meta3 = parseFloat(g.daily_goal_meta3 || 0);
        const meta2 = parseFloat(g.daily_goal_meta2 || 0);
        let bonusRule = null;
        if (meta4 > 0 && s.gValor >= meta4) {
          bonusRule = { rule_name: 'META_DIA_PLUS100', pts: rulePts.META_DIA_PLUS100 || 20, label: 'Meta 4', threshold: meta4 };
        } else if (meta3 > 0 && s.gValor >= meta3) {
          bonusRule = { rule_name: 'META_DIA_PLUS50', pts: rulePts.META_DIA_PLUS50 || 15, label: 'Meta 3', threshold: meta3 };
        } else if (meta2 > 0 && s.gValor >= meta2) {
          bonusRule = { rule_name: 'META_DIA_PLUS30', pts: rulePts.META_DIA_PLUS30 || 10, label: 'Meta 2', threshold: meta2 };
        }

        // Limpar tiers que possam ter sido gravados em rodadas anteriores
        const allBonusTiers = ['META_DIA_PLUS30', 'META_DIA_PLUS50', 'META_DIA_PLUS100'];
        if (recalcDay) {
          for (const tier of allBonusTiers) {
            if (!bonusRule || tier !== bonusRule.rule_name) {
              await deleteEvent(g.id, dateStr, tier);
            }
          }
        }

        if (bonusRule) {
          const threshold = bonusRule.threshold;
          dayEvents.push({
            group_id: g.id, event_date: dateStr, rule_name: bonusRule.rule_name,
            points: bonusRule.pts * mult,
            description: `${bonusRule.label}: R$ ${s.gValor.toFixed(2)} / meta R$ ${threshold.toFixed(2)}`,
            is_double: mult > 1,
          });
        }
      } else if (recalcDay) {
        await deleteEvent(g.id, dateStr, 'META_DIA');
        await deleteEvent(g.id, dateStr, 'META_DIA_PLUS30');
        await deleteEvent(g.id, dateStr, 'META_DIA_PLUS50');
        await deleteEvent(g.id, dateStr, 'META_DIA_PLUS100');
        await deleteEvent(g.id, dateStr, 'META_DIA_CLT');
        await deleteEvent(g.id, dateStr, 'META_DIA_FGTS');
      }

      // CONVERSAO: taxa de pagamento do dia >= 80% (padrão)
      if (s.gDay.length > 0 && s.gPaid.length / s.gDay.length >= CONVERSION_MIN_RATE) {
        const rate = s.gPaid.length / s.gDay.length;
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'CONVERSAO',
          points: rulePts.CONVERSAO * mult,
          description: `Conversão ${Math.round(rate * 100)}%: ${s.gPaid.length}/${s.gDay.length} pagos (meta ${Math.round(CONVERSION_MIN_RATE * 100)}%)`,
          is_double: mult > 1,
        });
      } else if (recalcDay) {
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

      // TORCIDA_ORGANIZADA: hoje (ranking ao vivo) ou retroativo em dia de jogo (force)
      const torcidaMap = (isToday ? vendorMap : vendorMapByDate[dateStr]) || {};
      const torcidaDataAvailable = isToday ? rankingOk : (vendorMapByDate[dateStr] !== undefined);
      if (isToday || (isForce && doubleDays.has(dateStr) && torcidaMap)) {
        if (!torcidaDataAvailable) {
          // Ranking indisponível — preserva evento existente sem avaliar
        } else if (g.member_count >= 5 && s.cids.every(cid => (torcidaMap[cid]?.qtd_propostas || 0) > 10)) {
          dayEvents.push({
            group_id: g.id, event_date: dateStr, rule_name: 'TORCIDA_ORGANIZADA',
            points: rulePts.TORCIDA_ORGANIZADA * mult,
            description: `Todos os ${g.member_count} integrantes com >10 propostas${mult > 1 ? ' (jogo do Brasil ×2)' : ''}`,
            is_double: mult > 1,
          });
        } else if (recalcDay) {
          await deleteEvent(g.id, dateStr, 'TORCIDA_ORGANIZADA');
        }
      }
    }

    await batchUpsertEvents(dayEvents);

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
    const weekBusinessDays = getBusinessDaysInRange(wsStr, weStr);
    const weekHasDouble = weekBusinessDays.some(d => doubleDays.has(d));

    // Semanas passadas: recalcular se force, semana atual ou semana com jogo do Brasil (retroativo)
    if (!isCurrentWeek && !isForce && !weekHasDouble) continue;

    // Multiplier: dobro se algum dia útil da semana foi dia de jogo
    const weekMult = weekHasDouble ? 2 : 1;

    const weekProps = allProposals.filter(p => {
      const d = getCadastroDateStr(p);
      return d && d >= wsStr && d <= weStr;
    });

    for (const g of groups) {
      const cids = (g.corban_ids || []).map(String);
      const gWeek = weekProps.filter(p => cids.includes(String(p.vendedor_id)));
      const gValorWeek = sumValorRef(gWeek);
      const weeklyGoal = parseFloat(g.weekly_goal_value || 0);

      if (weeklyGoal > 0 && gValorWeek >= weeklyGoal) {
        await upsertEvent(g.id, wsStr, 'META_SEMANA', rulePts.META_SEMANA * weekMult,
          `Meta semanal: R$ ${gValorWeek.toFixed(2)} / meta R$ ${weeklyGoal.toFixed(2)} (${wsStr}→${weStr})${weekMult > 1 ? ' · jogo do Brasil na semana ×2' : ''}`,
          weekMult > 1);
      } else if (isCurrentWeek || isForce || weekHasDouble) {
        await deleteEvent(g.id, wsStr, 'META_SEMANA');
      }

      // Legacy cleanup — META_SEMANA_CLT e META_SEMANA_FGTS removidos
      if (isCurrentWeek || isForce || weekHasDouble) {
        await deleteEvent(g.id, wsStr, 'META_SEMANA_CLT');
        await deleteEvent(g.id, wsStr, 'META_SEMANA_FGTS');
      }
    }
  }

  // ── 9. INDICACAO + CONTRATO_10K: acumulado da campanha (sem dobro — regras de campanha) ──
  for (const g of groups) {
    const cids   = (g.corban_ids || []).map(String);
    const gAll   = allProposals.filter(p => cids.includes(String(p.vendedor_id)));
    const paidAll = gAll.filter(isWeekdayPaid);

    const paidRefs = filterPaidIndicacoes(paidAll);
    const refBatches = Math.floor(paidRefs.length / 5);
    if (refBatches > 0) {
      await upsertEvent(
        g.id, campaignStart, 'INDICACAO',
        refBatches * rulePts.INDICACAO,
        `${paidRefs.length} contrato(s) pagos com Indicação — ${refBatches} lote(s) de 5 × ${rulePts.INDICACAO} pts`,
        false
      );
    } else {
      await deleteEvent(g.id, campaignStart, 'INDICACAO');
    }

    const hvCount = paidAll.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000).length;
    if (hvCount > 0) {
      await upsertEvent(g.id, campaignStart, 'CONTRATO_10K', hvCount * rulePts.CONTRATO_10K,
        `${hvCount} contrato(s) acima de R$ 10.000`, false);
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
