#!/usr/bin/env node
/**
 * Simula o placar de campanha contra a API real do NewCorban, sem banco e sem
 * subir nada. Serve para conferir os números contra o painel da NC antes de
 * expor o telão na TV.
 *
 *   node scripts/verificar-placar.js                  # hoje
 *   node scripts/verificar-placar.js 2026-08-10       # data específica
 *   node scripts/verificar-placar.js 2026-08-10 --cru # + estrutura de um registro
 *
 * Precisa apenas de NEWCORBAN_PROPOSALS_TOKEN (do .env ou do ambiente).
 * Não escreve nada, não altera nada.
 */

const fs = require('fs');
const path = require('path');

// ── Configuração da campanha (espelha o que está no banco) ──────────────────
const PRODUTOS = ['13'];               // 13 = Crédito do Trabalhador (CLT)
const MESMO_DIA = true;                // digitado e pago no mesmo dia
const LADDER = [
  { at: 5, prize: 20 }, { at: 10, prize: 20 }, { at: 15, prize: 30 },
  { at: 20, prize: 40 }, { at: 25, prize: 50 },
];
const STEP = { every: 5, prize: 20 };
const SPIN_EVERY = 5;
const EXCLUIR = [/^API.*/i, /.*\(Matriz\).*/i, /^BOT .*/i, /^ROBO.*/i, /^ROBÔ.*/i];

// ── Token ───────────────────────────────────────────────────────────────────
function lerToken() {
  if (process.env.NEWCORBAN_PROPOSALS_TOKEN) return process.env.NEWCORBAN_PROPOSALS_TOKEN;
  for (const p of ['../.env', '../backend/.env', '.env', 'backend/.env']) {
    const f = path.resolve(__dirname, p);
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, 'utf8').match(/^\s*NEWCORBAN_PROPOSALS_TOKEN\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Espelha externalApi.toBrazilDateStr — o script tem que enxergar a mesma data
// que o backend, senão ele deixa de ser um conferidor e vira uma segunda versão
// da verdade.
const BR_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' });

function dataBR(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return BR_DATE_FMT.format(d);
  }
  return s.slice(0, 10);
}

function escada(count) {
  let prize = 0;
  for (const t of LADDER) if (count >= t.at) prize += t.prize;
  const last = LADDER[LADDER.length - 1].at;
  if (count > last) prize += Math.floor((count - last) / STEP.every) * STEP.prize;
  const up = LADDER.find(t => t.at > count);
  let nextAt, nextPrize;
  if (up) { nextAt = up.at; nextPrize = up.prize; }
  else {
    const k = Math.floor((count - last) / STEP.every) + 1;
    nextAt = last + k * STEP.every; nextPrize = STEP.prize;
  }
  return { prize, spins: Math.floor(count / SPIN_EVERY), nextAt, nextPrize, missing: nextAt - count };
}

const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function buscar(token, dia) {
  const todas = [];
  let page = 1, lastPage = 1;
  do {
    const qs = new URLSearchParams({
      date_type: 'payment', start_date: dia, end_date: dia,
      per_page: '100', page: String(page),
    });
    qs.append('stage[]', 'paid');

    const res = await fetch(`https://developers.newcorban.com.br/v1/proposals?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      console.log('  rate limit, aguardando 10s...');
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'resposta sem success');
    todas.push(...(json.data || []));
    lastPage = json.meta?.last_page || 1;
    process.stdout.write(`  página ${page}/${lastPage} — ${todas.length} registros\r`);
    page++;
  } while (page <= lastPage);
  console.log('');
  return todas;
}

(async () => {
  const dia = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || hojeBR();
  const cru = process.argv.includes('--cru');

  const token = lerToken();
  if (!token) {
    console.error('NEWCORBAN_PROPOSALS_TOKEN não encontrado (nem no ambiente, nem no .env).');
    process.exit(1);
  }

  console.log(`\nMISSÃO RESGATE — simulação do placar para ${dia}`);
  console.log(`regra: produto ${PRODUTOS.join(',')} (CLT)${MESMO_DIA ? ' · digitado e pago no mesmo dia' : ''}\n`);
  console.log('buscando propostas pagas no dia...');

  const itens = await buscar(token, dia);

  if (cru && itens.length) {
    console.log('\n── ESTRUTURA DE UM REGISTRO (confere se o nome do vendedor vem na API) ──');
    console.log(JSON.stringify(itens[0], null, 2).slice(0, 2500));
    console.log('─'.repeat(74));
  }

  // Esta é a pergunta que o script existe para responder
  const comNome = itens.filter(i => i.assignment?.seller?.name).length;
  console.log(`\nnome do vendedor presente em ${comNome}/${itens.length} registros` +
    (itens.length && comNome === 0
      ? '  ← A API NÃO devolve o nome; o telão vai depender da tabela users'
      : itens.length ? '  ← ok, o telão mostra os nomes reais' : ''));

  // A pergunta do fuso: a API manda instante absoluto (UTC) ou horário local?
  // Se for UTC e ninguém converter, contrato digitado depois das 21h de Brasília
  // cai no dia seguinte e some do "digitado e pago no mesmo dia".
  const comFuso = itens.filter(i => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(i.dates?.created_at || '').trim()));
  const viraramDeDia = comFuso.filter(i => {
    const cru = String(i.dates.created_at).slice(0, 10);
    return dataBR(i.dates.created_at) !== cru;
  });
  console.log(
    `\ncadastro com fuso explícito em ${comFuso.length}/${itens.length} registros` +
    (comFuso.length === 0
      ? '  ← horário local, corte da string já estava certo'
      : `  ← UTC; ${viraramDeDia.length} mudariam de dia sem a conversão`)
  );
  if (itens.length) {
    console.log(`exemplo de created_at:   ${itens[0].dates?.created_at}`);
    // Se vier só data, a janela da API não tem ambiguidade de fuso nenhuma
    console.log(`exemplo de payment_date: ${itens[0].dates?.payment_date}`);
  }

  const porVendedor = new Map();
  let outroProduto = 0, outroDia = 0, naoHumano = 0;

  for (const it of itens) {
    const pago = dataBR(it.dates?.payment_date);
    if (pago !== dia) continue;

    if (!PRODUTOS.includes(String(it.proposal?.product?.id))) { outroProduto++; continue; }

    if (MESMO_DIA) {
      const cad = dataBR(it.dates?.created_at);
      if (cad !== dia) { outroDia++; continue; }
    }

    const nome = it.assignment?.seller?.name || '';
    if (EXCLUIR.some(rx => rx.test(nome))) { naoHumano++; continue; }

    const id = String(it.assignment?.seller?.id || '');
    if (!id) continue;
    if (!porVendedor.has(id)) porVendedor.set(id, { id, nome: nome || `Consultor ${id}`, qtd: 0, valor: 0 });
    const v = porVendedor.get(id);
    v.qtd++;
    v.valor += parseFloat(it.proposal?.reference_amount || 0) || 0;
  }

  const placar = [...porVendedor.values()].sort((a, b) => b.qtd - a.qtd || b.valor - a.valor);

  console.log('\n' + '═'.repeat(92));
  console.log('  #  CONSULTOR                            RECUP.   PRÊMIO    GIROS   FALTAM   PRODUÇÃO');
  console.log('═'.repeat(92));
  if (!placar.length) {
    console.log('  (ninguém pontuou com esta regra)');
  }
  placar.forEach((v, i) => {
    const e = escada(v.qtd);
    console.log(
      `  ${String(i + 1).padStart(2)}  ${v.nome.slice(0, 34).padEnd(34)} ` +
      `${String(v.qtd).padStart(6)}   ${brl(e.prize).padStart(9)} ${String(e.spins).padStart(6)}   ` +
      `${String(e.missing).padStart(6)}   ${brl(v.valor).padStart(13)}`
    );
  });
  console.log('═'.repeat(92));

  const totQtd = placar.reduce((s, v) => s + v.qtd, 0);
  const totVal = placar.reduce((s, v) => s + v.valor, 0);
  const totPremio = placar.reduce((s, v) => s + escada(v.qtd).prize, 0);

  console.log(`\nTOTAIS   ${totQtd} recuperações · ${brl(totVal)} recuperados · ${placar.length} consultores`);
  console.log(`PRÊMIOS  ${brl(totPremio)} em premiação individual · ${placar.reduce((s, v) => s + escada(v.qtd).spins, 0)} giros`);

  console.log('\n── POR QUE CONTRATOS FICARAM DE FORA ──');
  console.log(`  pagos no dia (total da API): ${itens.length}`);
  console.log(`  outro produto (não CLT):     ${outroProduto}`);
  console.log(`  digitados em outro dia:      ${outroDia}`);
  console.log(`  contas não-humanas (IA/bot): ${naoHumano}`);
  console.log(`  entraram no placar:          ${totQtd}`);

  console.log('\nCompare "pagos no dia" com o painel da NC (Período: Pagamento, mesma data).');
  console.log('Se o total bater e só a filtragem diferir, a regra está certa.\n');
})().catch(err => {
  console.error('\nFALHOU:', err.message);
  process.exit(1);
});
