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

/** Retorna a data de pagamento da proposta como YYYY-MM-DD, ou null se não paga. */
function getPayDateStr(p) {
  const raw = p.datas?.pagamento;
  if (!raw) return null;
  return String(raw).slice(0, 10);
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

const DAILY_RULES = ['META_DIA', 'META_DIA_PLUS30', 'META_DIA_PLUS50', 'META_DIA_PLUS100', 'META_DIA_CLT', 'META_DIA_FGTS', 'CONVERSAO', 'CONTRATO_10K', 'GOL_DE_PLACA', 'ARTILHEIRO', 'TORCIDA_ORGANIZADA'];

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

  // Snapshot antes do cálculo (para log de deltas)
  const { rows: beforeRows } = await db.query(`
    SELECT se.group_id, se.event_date::text, se.rule_name, se.points, g.name AS group_name
    FROM score_events se JOIN groups g ON se.group_id = g.id
    WHERE se.event_date >= $1
  `, [campaignStart]);
  const beforeMap = {};
  beforeRows.forEach(r => {
    beforeMap[`${r.group_id}:${String(r.event_date).slice(0,10)}:${r.rule_name}`] = {
      points: parseFloat(r.points), group_name: r.group_name,
      group_id: r.group_id, event_date: String(r.event_date).slice(0,10), rule_name: r.rule_name,
    };
  });

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
      // META_DIA/META_SEMANA: valor baseado na data de pagamento (não cadastro)
      const gPaidOnDate = allProposals.filter(p => cids.includes(String(p.vendedor_id)) && getPayDateStr(p) === dateStr);
      const gValor = sumValorRef(gPaidOnDate);
      const gMaxC  = gPaid.reduce((mx, p) => Math.max(mx, parseFloat(p.proposta?.valor_referencia || 0)), 0);

      // ARTILHEIRO: melhor vendedor individual — conta contratos pagos neste dia (por data de pagamento)
      const paidPerCid = {};
      gPaidOnDate.forEach(p => {
        const cid = String(p.vendedor_id);
        paidPerCid[cid] = (paidPerCid[cid] || 0) + 1;
      });
      const topEntry = Object.entries(paidPerCid).sort(([, a], [, b]) => b - a)[0];
      const gMaxIndividualP = topEntry ? topEntry[1] : 0;
      const gTopArtCid      = topEntry ? topEntry[0] : null;
      // Desempate: soma dos valores dos contratos pagos neste dia do melhor vendedor
      const gTopArtValor = gTopArtCid
        ? gPaidOnDate.filter(p => String(p.vendedor_id) === gTopArtCid)
                     .reduce((s, p) => s + parseFloat(p.proposta?.valor_referencia || 0), 0)
        : 0;

      const gDayConversao = gDay.filter(p => p.api?.status_api !== 'CANCELADA');

      // TORCIDA_ORGANIZADA: todos os membros com >= 10 contratos pagos neste dia (por data de pagamento)
      const torcidaPaidByCid = {};
      gPaidOnDate.forEach(p => {
        const cid = String(p.vendedor_id);
        torcidaPaidByCid[cid] = (torcidaPaidByCid[cid] || 0) + 1;
      });

      gStats[g.id] = { cids, gDay, gPaid, gValor, gMaxC, gMaxIndividualP, gTopArtCid, gTopArtValor, gDayConversao, torcidaPaidByCid };
    }

    // Máximos globais para regras competitivas
    const globalMaxC = groups.reduce((mx, g) => Math.max(mx, gStats[g.id].gMaxC), 0);
    const globalMaxP = groups.reduce((mx, g) => Math.max(mx, gStats[g.id].gMaxIndividualP), 0);
    const golWinners = globalMaxC > 0 ? groups.filter(g => gStats[g.id].gMaxC === globalMaxC).map(g => g.id) : [];
    // Empate em qtd de contratos → desempate pela soma de valores do melhor vendedor
    const artTied = globalMaxP > 0 ? groups.filter(g => gStats[g.id].gMaxIndividualP === globalMaxP) : [];
    const globalMaxArtValor = artTied.reduce((mx, g) => Math.max(mx, gStats[g.id].gTopArtValor), 0);
    const artWinners = artTied.filter(g => gStats[g.id].gTopArtValor >= globalMaxArtValor).map(g => g.id);

    // Consultor que fez o maior contrato em cada grupo vencedor
    const golConsultor = {};
    for (const g of groups) {
      if (!golWinners.includes(g.id)) continue;
      const maxProp = gStats[g.id].gPaid.reduce((mx, p) => {
        return parseFloat(p.proposta?.valor_referencia || 0) >= parseFloat(mx?.proposta?.valor_referencia || 0) ? p : mx;
      }, gStats[g.id].gPaid[0] || null);
      if (maxProp) golConsultor[g.id] = corbanToName[String(maxProp.vendedor_id)] || null;
    }

    // Consultor artilheiro de cada grupo vencedor (já calculado no gStats)
    const artConsultor = {};
    for (const g of groups) {
      if (!artWinners.includes(g.id)) continue;
      const cid = gStats[g.id].gTopArtCid;
      if (cid) artConsultor[g.id] = corbanToName[cid] || null;
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

      // CONVERSAO: mínimo 10 propostas no dia + taxa de pagamento >= 80% (padrão); CANCELADA excluídas
      const CONVERSION_MIN_PROPOSALS = 10;
      if (s.gDayConversao.length >= CONVERSION_MIN_PROPOSALS && s.gPaid.length / s.gDayConversao.length >= CONVERSION_MIN_RATE) {
        const rate = s.gPaid.length / s.gDayConversao.length;
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'CONVERSAO',
          points: rulePts.CONVERSAO * mult,
          description: `Conversão ${Math.round(rate * 100)}%: ${s.gPaid.length}/${s.gDayConversao.length} pagos (mín. ${CONVERSION_MIN_PROPOSALS} propostas)`,
          is_double: mult > 1,
        });
      } else if (recalcDay) {
        await deleteEvent(g.id, dateStr, 'CONVERSAO');
      }

      // CONTRATO_10K: contratos pagos hoje com valor > R$ 10.000
      const hvCount = s.gPaid.filter(p => parseFloat(p.proposta?.valor_referencia || 0) > 10000).length;
      if (hvCount > 0) {
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'CONTRATO_10K',
          points: hvCount * (rulePts.CONTRATO_10K || 5) * mult,
          description: `${hvCount} contrato(s) acima de R$ 10.000`,
          is_double: mult > 1,
        });
      } else if (recalcDay) {
        await deleteEvent(g.id, dateStr, 'CONTRATO_10K');
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

      // ARTILHEIRO: mais contratos pagos do dia (competitivo; desempate por valor)
      if (artWinners.includes(g.id)) {
        const consultor = artConsultor[g.id];
        const artValor = gStats[g.id].gTopArtValor;
        const hasTie = artTied.length > artWinners.length || (artTied.length > 1 && artWinners.length > 0);
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'ARTILHEIRO',
          points: rulePts.ARTILHEIRO * mult,
          description: `Artilheiro: ${globalMaxP} contratos pagos${hasTie ? ` · desempate R$ ${artValor.toFixed(2)}` : ''}${consultor ? ` · ${consultor}` : ''}`,
          is_double: mult > 1,
        });
      }

      // TORCIDA_ORGANIZADA: todos os membros com >= 10 propostas pagas no dia (independe data pagamento)
      const allTorcidaMet = s.cids.length > 0 && s.cids.every(cid => (s.torcidaPaidByCid[cid] || 0) >= 10);
      if (allTorcidaMet) {
        const minPaid = Math.min(...s.cids.map(cid => s.torcidaPaidByCid[cid] || 0));
        dayEvents.push({
          group_id: g.id, event_date: dateStr, rule_name: 'TORCIDA_ORGANIZADA',
          points: rulePts.TORCIDA_ORGANIZADA * mult,
          description: `Todos os ${s.cids.length} integrante(s) com ≥10 propostas pagas (mín. ${minPaid})${mult > 1 ? ' (jogo do Brasil ×2)' : ''}`,
          is_double: mult > 1,
        });
      } else if (recalcDay) {
        await deleteEvent(g.id, dateStr, 'TORCIDA_ORGANIZADA');
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

    // META_SEMANA: soma por data de pagamento dentro da semana
    const weekProps = allProposals.filter(p => {
      const d = getPayDateStr(p);
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

    // Limpar evento legado de CONTRATO_10K acumulado (migração para regra diária)
    await deleteEvent(g.id, campaignStart, 'CONTRATO_10K');
  }

  // ── 10. Marcar hoje no daily_calculations ────────────────────────────────
  await db.query(
    `INSERT INTO daily_calculations (calculation_date, triggered_by)
     VALUES ($1, $2) ON CONFLICT (calculation_date) DO UPDATE SET calculated_at = NOW(), triggered_by = $2`,
    [todayStr, triggeredBy]
  );

  console.log(`[Scoring] ✅ ${totalEvents.length} eventos diários gerados`);

  // ── 11. Log de histórico de pontuação ────────────────────────────────────
  try {
    const { rows: afterRows } = await db.query(`
      SELECT se.group_id, se.event_date::text, se.rule_name, se.points, g.name AS group_name
      FROM score_events se JOIN groups g ON se.group_id = g.id
      WHERE se.event_date >= $1
    `, [campaignStart]);
    const afterMap = {};
    afterRows.forEach(r => {
      afterMap[`${r.group_id}:${String(r.event_date).slice(0,10)}:${r.rule_name}`] = {
        points: parseFloat(r.points), group_name: r.group_name,
        group_id: r.group_id, event_date: String(r.event_date).slice(0,10), rule_name: r.rule_name,
      };
    });

    const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
    const changes = [];
    for (const key of allKeys) {
      const b = beforeMap[key];
      const a = afterMap[key];
      const oldPts = b ? b.points : 0;
      const newPts = a ? a.points : 0;
      if (Math.abs(newPts - oldPts) > 0.001) {
        const ref = a || b;
        changes.push({ group_id: ref.group_id, group_name: ref.group_name,
          event_date: ref.event_date, rule_name: ref.rule_name,
          old_points: oldPts, new_points: newPts, delta: newPts - oldPts });
      }
    }

    const { rows: runRows } = await db.query(
      'INSERT INTO scoring_runs (triggered_by) VALUES ($1) RETURNING id',
      [triggeredBy]
    );
    const runId = runRows[0].id;

    if (changes.length > 0) {
      const params = [runId];
      const clauses = changes.map((c, i) => {
        const b = i * 7 + 2;
        params.push(c.group_id, c.group_name, c.event_date, c.rule_name, c.old_points, c.new_points, c.delta);
        return `($1,$${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
      });
      await db.query(
        `INSERT INTO scoring_run_events (run_id,group_id,group_name,event_date,rule_name,old_points,new_points,delta) VALUES ${clauses.join(',')}`,
        params
      );
    }
  } catch (logErr) {
    console.error('[Scoring] Erro ao salvar log:', logErr.message);
  }

  return totalEvents;
}

module.exports = { calculateScores };
