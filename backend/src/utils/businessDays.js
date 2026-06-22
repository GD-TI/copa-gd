/** Segunda (1) a sexta (5) em UTC (datas YYYY-MM-DD). */
function isBusinessDay(dateStr) {
  if (!dateStr) return false;
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

function getCadastroDateStr(proposal) {
  const raw = proposal?.datas?.cadastro || proposal?.datas?.inclusao;
  return raw ? String(raw).slice(0, 10) : null;
}

function getPagamentoDateStr(proposal) {
  const raw = proposal?.datas?.pagamento;
  return raw ? String(raw).slice(0, 10) : null;
}

/** Proposta digitada (cadastro) em dia útil. */
function isWeekdayCadastro(proposal) {
  const d = getCadastroDateStr(proposal);
  return Boolean(d && isBusinessDay(d));
}

/** Proposta paga em dia útil (cadastro e pagamento em dia útil). */
function isWeekdayPaid(proposal) {
  if (!proposal?.datas?.pagamento) return false;
  const pay = getPagamentoDateStr(proposal);
  return isWeekdayCadastro(proposal) && Boolean(pay && isBusinessDay(pay));
}

function filterByWeekdayCadastro(proposals) {
  return (proposals || []).filter(isWeekdayCadastro);
}

function filterByWeekdayPaid(proposals) {
  return (proposals || []).filter(isWeekdayPaid);
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

function getBusinessDaysInRange(startStr, endStr) {
  return getDaysInRange(startStr, endStr).filter(isBusinessDay);
}

module.exports = {
  isBusinessDay,
  getCadastroDateStr,
  getPagamentoDateStr,
  isWeekdayCadastro,
  isWeekdayPaid,
  filterByWeekdayCadastro,
  filterByWeekdayPaid,
  getDaysInRange,
  getBusinessDaysInRange,
};
