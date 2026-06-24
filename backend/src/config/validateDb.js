/**
 * Valida DATABASE_URL e ajuda a diagnosticar erros comuns em produção.
 */
function parseDbHost(url) {
  if (!url) return null;
  try {
    return new URL(url.replace(/^postgresql:\/\//, 'postgres://')).hostname;
  } catch {
    return null;
  }
}

function validateDatabaseUrl() {
  const url = process.env.DATABASE_URL;

  if (!url || !url.trim()) {
    return {
      ok: false,
      message: 'DATABASE_URL não está definida. Configure no painel da Hostinger (Variáveis de ambiente).',
    };
  }

  const host = parseDbHost(url);
  const placeholders = ['host', 'seu-host', 'hostname'];

  if (!host || placeholders.includes(host.toLowerCase())) {
    return {
      ok: false,
      message:
        `DATABASE_URL aponta para "${host || '?'}". ` +
        'Substitua pelo host real do PostgreSQL (ex: srv123.hstgr.io ou ep-xxx.neon.tech). ' +
        'Não use o valor de exemplo do .env.example.',
    };
  }

  if (url.includes('usuario:senha@') || url.includes('user:password@')
      || url.includes('USUARIO:SENHA@') || url.includes('HOST_REAL')) {
    return {
      ok: false,
      message: 'DATABASE_URL ainda contém usuario:senha de exemplo. Use credenciais reais do banco.',
    };
  }

  return { ok: true, host };
}

module.exports = { validateDatabaseUrl, parseDbHost };
