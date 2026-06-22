/**
 * Contrato com origem de Indicação (NewCorban).
 * Critério da campanha: campo `origem` deve conter "Indicação".
 */
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

/** Contratos pagos com Indicação. */
function filterPaidIndicacoes(proposals) {
  return (proposals || []).filter(p => isPaidProposal(p) && isIndicacaoProposal(p));
}

module.exports = {
  isIndicacaoProposal,
  isPaidProposal,
  filterPaidIndicacoes,
};
