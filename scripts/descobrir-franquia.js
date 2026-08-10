#!/usr/bin/env node
/**
 * Descobre como o NewCorban marca a franquia/unidade do consultor, para que o
 * placar de campanha possa ficar só com a matriz.
 *
 * Responde três perguntas numa rodada:
 *   1. Qual campo do cadastro do consultor carrega a franquia, e qual valor é a matriz
 *   2. Dos vendedores que aparecem no placar de hoje, quem é de qual franquia
 *   3. Quem o filtro de contas não-humanas está derrubando hoje
 *
 *   node scripts/descobrir-franquia.js                 # hoje
 *   node scripts/descobrir-franquia.js 2026-08-10      # data específica
 *
 * Usa o mesmo externalApi do backend — o que ele enxergar aqui é exatamente o
 * que o backend enxerga. Só lê: não escreve no banco nem na API.
 *
 * Precisa de NEWCORBAN_USERNAME + NEWCORBAN_PASSWORD (lista de consultores) e,
 * para a parte do placar, NEWCORBAN_PROPOSALS_TOKEN. Roda com o que tiver.
 */

const fs = require('fs');
const path = require('path');

// ── .env para process.env (o externalApi lê de lá na hora da chamada) ───────
for (const rel of ['../.env', '../backend/.env']) {
  const f = path.resolve(__dirname, rel);
  if (!fs.existsSync(f)) continue;
  for (const linha of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const valor = m[2].trim().replace(/^["']|["']$/g, '');
    if (valor && !process.env[m[1]]) process.env[m[1]] = valor;
  }
}

const externalApi = require('../backend/src/services/externalApi');

// Mesmos padrões que o seed grava em ranking_exclusions
const EXCLUSOES = [
  ['API%', 'Integração / IA'],
  ['%(Matriz)%', 'Conta de matriz, não é consultor'],
  ['BOT %', 'Robô'],
  ['ROBO%', 'Robô'],
  ['ROBÔ%', 'Robô'],
];

/** Mesma tradução de padrão que buildExcluder faz em campaigns.js */
function paraRegex(padrao) {
  const rx = String(padrao).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
  return new RegExp(`^${rx}$`, 'i');
}

function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Achata o objeto para "a.b.c" → valor, para caçar o campo em qualquer nível. */
function achatar(obj, prefixo = '', saida = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) achatar(v, chave, saida);
    else saida[chave] = v;
  }
  return saida;
}

const CANDIDATO = /franqui|filial|unidade|matriz|branch|unit|empresa|company|store|loja/i;
const linha = c => console.log(c.repeat(78));

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

/**
 * Despeja o cadastro inteiro de um consultor. É o jeito direto de descobrir o
 * que separa quem é da matriz de quem não é: compara-se um de cada lado e o
 * campo que difere é o campo.
 */
function despejarCadastro(usuarios, busca) {
  const alvo = busca.trim().toLowerCase();
  const achados = usuarios.filter(u =>
    [u.nome, u.name, u.usuario, u.username]
      .some(v => String(v || '').toLowerCase().includes(alvo))
  );

  linha('═');
  console.log(`CADASTRO DE "${busca}" — ${achados.length} encontrado(s)`);
  linha('═');

  if (!achados.length) {
    console.log('Ninguém com esse nome no cadastro do NewCorban.');
    console.log('Se essa pessoa aparece no placar, ela já sai pelo filtro de franquia');
    console.log('(que é lista branca por cadastro), independente da unidade dela.\n');
    return;
  }

  for (const u of achados.slice(0, 3)) {
    console.log(`\n${u.nome || u.name || u.usuario || u.username}  (id ${u.id})`);
    for (const [k, v] of Object.entries(achatar(u))) {
      const marca = CANDIDATO.test(k) ? ' ←' : '';
      console.log(`   ${k.padEnd(30)} ${String(v)}${marca}`);
    }
  }
  console.log('');
}

(async () => {
  const dia = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || hojeBR();
  const quem = arg('--quem');
  // "sem" = matriz é quem NÃO tem franquia_id (verificado no espelho do CRM).
  // Passe --matriz 7 para simular uma franquia específica.
  const matriz = arg('--matriz') || 'sem';
  const ehMatriz = v => matriz === 'sem'
    ? (v === null || v === undefined || String(v).trim() === '')
    : String(v ?? '') === matriz;

  // ── 1. Cadastro do consultor ───────────────────────────────────────────────
  linha('═');
  console.log('1. CADASTRO DO CONSULTOR — onde está a franquia');
  linha('═');

  let usuarios = [];
  try {
    usuarios = await externalApi.listarEquipe();
    console.log(`${usuarios.length} consultores no NewCorban\n`);
  } catch (err) {
    console.log(`não consegui listar: ${err.message}`);
    console.log('(precisa de NEWCORBAN_USERNAME e NEWCORBAN_PASSWORD)\n');
  }

  let campoFranquia = null;

  if (usuarios.length) {
    const plano = achatar(usuarios[0]);
    console.log('campos disponíveis no registro de um consultor:');
    console.log('  ' + Object.keys(plano).join(', ') + '\n');

    const candidatos = Object.keys(plano).filter(k => CANDIDATO.test(k));
    if (!candidatos.length) {
      console.log('nenhum campo com cara de franquia/unidade neste registro.');
      console.log('registro de exemplo, cru:');
      console.log(JSON.stringify(usuarios[0], null, 2).slice(0, 1800) + '\n');
    }

    // Para cada candidato, a distribuição de valores diz qual é o campo certo:
    // o de verdade tem poucos valores distintos e um deles concentra a matriz.
    for (const campo of candidatos) {
      const conta = new Map();
      for (const u of usuarios) {
        const v = achatar(u)[campo];
        const chave = v === undefined || v === null || v === '' ? '(vazio)' : String(v);
        if (!conta.has(chave)) conta.set(chave, []);
        conta.get(chave).push(u.nome || u.name || u.usuario || u.username || u.id);
      }
      const ordenado = [...conta.entries()].sort((a, b) => b[1].length - a[1].length);
      console.log(`── ${campo} — ${ordenado.length} valor(es) distinto(s)`);
      for (const [valor, nomes] of ordenado.slice(0, 12)) {
        console.log(`   ${String(valor).padEnd(28)} ${String(nomes.length).padStart(4)} consultor(es)   ex: ${nomes.slice(0, 2).join(' · ')}`);
      }
      if (ordenado.length > 12) console.log(`   … mais ${ordenado.length - 12} valor(es)`);
      console.log('');
      if (!campoFranquia && /franqui|filial|unidade/i.test(campo)) campoFranquia = campo;
    }

    if (campoFranquia) {
      const naMatriz = usuarios.filter(u => ehMatriz(achatar(u)[campoFranquia]));
      console.log(`>> se matriz = ${matriz} em "${campoFranquia}": ${naMatriz.length} consultor(es)`);
      console.log('   ' + naMatriz.slice(0, 8).map(u => u.nome || u.name || u.usuario || u.username).join(' · ') +
        (naMatriz.length > 8 ? ` … +${naMatriz.length - 8}` : '') + '\n');
    }
  }

  if (quem && usuarios.length) despejarCadastro(usuarios, quem);

  // ── 2. e 3. Quem está no placar de hoje ────────────────────────────────────
  linha('═');
  console.log(`2. VENDEDORES NO PLACAR DE ${dia} — franquia de cada um`);
  linha('═');

  if (!process.env.NEWCORBAN_PROPOSALS_TOKEN) {
    console.log('NEWCORBAN_PROPOSALS_TOKEN ausente — pulando a parte do placar.\n');
    process.exit(0);
  }

  const propostas = await externalApi.getProposalsV3(dia, dia, [], 'payment', ['paid'], 60_000);

  // Só produto 13 (CLT), digitado e pago no mesmo dia — a regra da Missão Resgate
  const porVendedor = new Map();
  for (const p of Object.values(propostas)) {
    if (p.datas?.pagamento !== dia) continue;
    if (String(p.proposta?.produto_id) !== '13') continue;
    if (p.datas?.cadastro !== dia) continue;
    const id = String(p.vendedor_id || '');
    if (!id) continue;
    if (!porVendedor.has(id)) porVendedor.set(id, { id, nome: p.vendedor_nome || '', equipe: p.equipe_nome || '', qtd: 0 });
    porVendedor.get(id).qtd++;
  }

  const porId = new Map(usuarios.map(u => [String(u.id), u]));
  const placar = [...porVendedor.values()].sort((a, b) => b.qtd - a.qtd);

  console.log(`${placar.length} vendedor(es) com contrato digitado e pago em ${dia}`);
  console.log(`veredito simulando franquia = ${matriz}\n`);
  console.log('  QTD  CONSULTOR                          FRANQUIA    VEREDITO   EQUIPE');
  linha('─');

  let entram = 0, saem = 0;
  for (const v of placar) {
    const u = porId.get(v.id);
    const fr = u && campoFranquia ? String(achatar(u)[campoFranquia] ?? '(vazio)') : (u ? '?' : '—');
    // Sem cadastro no NC a pessoa sai: o filtro é lista branca, não lista negra
    const fica = Boolean(u) && ehMatriz(campoFranquia ? achatar(u)[campoFranquia] : undefined);
    fica ? entram++ : saem++;
    const veredito = !u ? 'SAI s/cad' : fica ? 'entra' : 'SAI';
    console.log(
      `  ${String(v.qtd).padStart(3)}  ${(v.nome || `Consultor ${v.id}`).slice(0, 32).padEnd(32)} ` +
      `${fr.padEnd(11)} ${veredito.padEnd(10)} ${v.equipe}`
    );
  }

  linha('─');
  console.log(`${entram} entra(m) no placar · ${saem} sai(em) por não ser da franquia ${matriz}`);
  if (!campoFranquia) {
    console.log('ATENÇÃO: nenhum campo de franquia foi resolvido — o veredito acima não vale.');
  }

  linha('═');
  console.log('3. QUEM O FILTRO DE CONTAS NÃO-HUMANAS ESTÁ DERRUBANDO');
  linha('═');

  let algum = false;
  for (const [padrao, motivo] of EXCLUSOES) {
    const rx = paraRegex(padrao);
    const pegos = placar.filter(v => rx.test(String(v.nome).trim()));
    console.log(`── ${padrao.padEnd(14)} (${motivo}): ${pegos.length}`);
    for (const v of pegos) {
      algum = true;
      console.log(`     ${v.nome}  —  ${v.qtd} contrato(s)`);
    }
  }
  if (!algum) {
    console.log('\nNinguém do placar de hoje casa com nenhum padrão.');
    console.log('Se você esperava a IA aqui, o padrão está ancorado no começo do nome');
    console.log('e os nomes da NC vêm prefixados pela equipe — é o problema que eu apontei.');
  }
  console.log('');

  process.exit(0);
})().catch(err => {
  console.error('\nFALHOU:', err.message);
  process.exit(1);
});
