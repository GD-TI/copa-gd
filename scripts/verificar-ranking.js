#!/usr/bin/env node
/**
 * Confere o ranking individual contra a API real do NewCorban, sem banco e sem
 * subir nada. Serve para bater os números com o painel da NC antes de expor na TV.
 *
 *   node scripts/verificar-ranking.js                    # mês corrente + digitados de hoje
 *   node scripts/verificar-ranking.js 2026-07            # um mês específico
 *   node scripts/verificar-ranking.js 2026-07 2026-08-11 # mês + dia específicos
 *
 * Precisa de NEWCORBAN_USERNAME + NEWCORBAN_PASSWORD (o ranking.php usa o token
 * v2). Não escreve nada, não altera nada.
 *
 * O banco é substituído por um stub que devolve os padrões de exclusão padrão
 * — os mesmos que a migration insere. Se você mexeu em `ranking_exclusions` em
 * produção, este script não enxerga a mudança.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const SRC = path.join(RAIZ, 'backend', 'src');

// ── .env para process.env ───────────────────────────────────────────────────
for (const rel of ['.env', 'backend/.env']) {
  const f = path.join(RAIZ, rel);
  if (!fs.existsSync(f)) continue;
  for (const linha of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

// ── Banco fora do caminho: só a lista de exclusões importa aqui ─────────────
const PADROES_PADRAO = [
  { corban_id: null, name_pattern: 'API%' },
  { corban_id: null, name_pattern: '%(Matriz)%' },
  { corban_id: null, name_pattern: 'BOT %' },
  { corban_id: null, name_pattern: 'ROBO%' },
  { corban_id: null, name_pattern: 'ROBÔ%' },
];
const dbPath = require.resolve(path.join(SRC, 'config', 'db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, children: [], paths: [],
  exports: {
    query: async (text) => {
      if (text.includes('ranking_exclusions')) return { rows: PADROES_PADRAO };
      throw new Error(`query não prevista neste script: ${text.slice(0, 60)}`);
    },
  },
};

const { rankingMensal, digitadosDoDia, hojeBR, mesAtual } = require(path.join(SRC, 'services', 'rankingIndividual'));

const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Escrita SÍNCRONA no stdout.
 *
 * `console.log` é assíncrono quando o stdout não é um terminal de verdade — e no
 * Git Bash (mintty) o Node vê um pipe mesmo com a janela aberta. O processo
 * terminava antes de esvaziar o buffer e o relatório **sumia inteiro**, deixando
 * só as linhas de log dos serviços: exit 0, nenhum erro, nenhuma tabela. Rodar
 * com `--trace-exit` fazia aparecer, porque atrasava a saída o bastante — o tipo
 * de sintoma que faz procurar bug no lugar errado.
 */
const escrever = linha => fs.writeSync(1, linha + '\n');

function tabela(titulo, dados, coluna) {
  const { board, totals, diagnostics } = dados;
  escrever(`\n${'='.repeat(78)}`);
  escrever(titulo);
  escrever('='.repeat(78));
  escrever(
    `${board.length} participantes · ${totals.contratos} contratos · ${brl(totals.valor)}\n` +
    `filtro: ${diagnostics.linhas_api} linhas da API → ${diagnostics.nao_humanos} não-humanos ` +
    `e ${diagnostics.sem_movimento} sem movimento fora\n` +
    `cadastro=${diagnostics.cadastro_ok ? 'ok' : 'FORA'} · exclusões=${diagnostics.exclusoes_ok ? 'ok' : 'FORA'} ` +
    `· procedência=${diagnostics.procedencia_ok ? 'ok' : 'FORA'} · produtos=${diagnostics.produtos.join('/')}\n`
  );

  escrever(
    '  #  CONSULTOR                        ' +
    coluna.padEnd(16) + 'CONTRATOS   META          ATING  ORIGEM'
  );
  for (const v of board) {
    // Os dois rankings ordenam por R$ (o dos digitados desde 20/08/2026), então
    // é o R$ que vai na coluna de destaque nos dois. A contagem fica na coluna
    // CONTRATOS ao lado — destacar um número que não ordena a lista faz a
    // tabela parecer fora de ordem, que é o oposto do que este script serve.
    const destaque = brl(v.valor);
    const origem = [v.equipe, v.franquia_nome].filter(Boolean).join(' · ') || '—';
    escrever(
      `${String(v.position).padStart(3)}. ` +
      `${v.nome.slice(0, 32).padEnd(32)} ` +
      `${destaque.padEnd(16)}` +
      `${String(v.contratos).padEnd(12)}` +
      `${brl(v.valor_meta).padEnd(14)}` +
      `${(v.atingimento === null ? '—' : v.atingimento.toFixed(0) + '%').padStart(5)}  ` +
      `${origem.slice(0, 28)}`
    );
  }
}

(async () => {
  const mes = process.argv[2] || mesAtual();
  const dia = process.argv[3] || hojeBR();

  const mensal = await rankingMensal(mes);
  tabela(
    `RANKING MENSAL — ${mes} (pagos de ${mensal.inicio} a ${mensal.fim})` +
    `${mensal.ao_vivo ? '  [mês em andamento]' : ''}`,
    mensal, 'R$ PAGO'
  );

  const digitados = await digitadosDoDia(dia);
  tabela(
    `DIGITADOS DO DIA — ${dia}${digitados.ao_vivo ? '  [hoje, ao vivo]' : ''}`,
    digitados, 'R$ DIGITADO'
  );
})().catch(err => {
  // Sem process.exit(0) no caminho feliz: com stdout redirecionado ele corta a
  // escrita pendente e o relatório sai vazio. O processo termina sozinho — o
  // timer de faxina do externalApi é unref.
  console.error('\nERRO:', err.message);
  process.exitCode = 1;
});
