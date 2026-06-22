/**
 * Contrato com origem de Indicação (NewCorban).
 * Critério da campanha: campo `origem` deve conter "Indicação".
 */
const { isWeekdayPaid } = require('./businessDays');

function isIndicacaoProposal(proposal) {
  if (!proposal) return false;

  const origem = String(proposal.origem || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  return origem.includes('indicacao');
}

function isPaidProposal(proposal) {
  return Boolean(proposal?.datas?.pagamento);
}

/** Contratos pagos com Indicação (somente dias úteis). */
function filterPaidIndicacoes(proposals) {
  return (proposals || []).filter(p => isWeekdayPaid(p) && isIndicacaoProposal(p));
}

module.exports = {
  isIndicacaoProposal,
  isPaidProposal,
  filterPaidIndicacoes,
};
