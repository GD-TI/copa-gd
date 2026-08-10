#!/usr/bin/env node
/**
 * Responde se o nosso próprio banco já sabe quem é da matriz — e, se souber,
 * o filtro do placar sai da API do NewCorban e vira uma query local.
 *
 *   node scripts/inspecionar-consultores.js
 *   node scripts/inspecionar-consultores.js --url "postgresql://user:senha@host:5432/copa_gd"
 *
 * Só lê: nenhum INSERT, UPDATE ou DDL. Usa a DATABASE_URL do .env se você não
 * passar --url.
 */

const fs = require('fs');
const path = require('path');

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

const argUrl = (() => {
  const i = process.argv.indexOf('--url');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const url = argUrl || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não encontrada. Passe --url "postgresql://..." ou configure o .env.');
  process.exit(1);
}

const { Pool } = require('../backend/node_modules/pg');

// Mesma regra de SSL do backend, para não travar em banco gerenciado
const pool = new Pool({
  connectionString: url,
  ssl: /sslmode=require/.test(url) || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 8000,
});

const CANDIDATO = /franqui|filial|unidade|matriz|branch|unit|empresa|company|store|loja/i;
const linha = c => console.log(c.repeat(76));

(async () => {
  // ── 1. Colunas de users ────────────────────────────────────────────────────
  linha('═');
  console.log('1. COLUNAS DA TABELA users');
  linha('═');

  const { rows: cols } = await pool.query(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'users'
     ORDER BY ordinal_position
  `);

  if (!cols.length) {
    console.log('Tabela users não existe neste banco. Confere a DATABASE_URL.');
    await pool.end();
    process.exit(1);
  }

  for (const c of cols) {
    const marca = CANDIDATO.test(c.column_name) ? '   ← candidato a franquia' : '';
    console.log(`  ${c.column_name.padEnd(26)} ${c.data_type}${marca}`);
  }

  const candidatas = cols.map(c => c.column_name).filter(n => CANDIDATO.test(n));
  console.log(candidatas.length
    ? `\n${candidatas.length} coluna(s) com cara de franquia: ${candidatas.join(', ')}`
    : '\nNenhuma coluna de franquia. O filtro tem que vir do cadastro do NewCorban.');

  // ── 2. Quantos consultores temos ───────────────────────────────────────────
  linha('═');
  console.log('2. QUANTOS CONSULTORES ESTÃO NO NOSSO BANCO');
  linha('═');

  const { rows: [n] } = await pool.query(`
    SELECT COUNT(*)::int                                                   AS total,
           COUNT(*) FILTER (WHERE corban_id IS NOT NULL)::int              AS com_corban_id,
           COUNT(*) FILTER (WHERE active AND corban_id IS NOT NULL)::int   AS ativos_com_corban_id,
           COUNT(*) FILTER (WHERE role = 'player')::int                    AS players
      FROM users
  `);
  console.log(`  total de linhas .............. ${n.total}`);
  console.log(`  com corban_id ................ ${n.com_corban_id}`);
  console.log(`  ativos com corban_id ......... ${n.ativos_com_corban_id}`);
  console.log(`  role = player ................ ${n.players}`);
  console.log('\nSe esse número for muito menor que o total de consultores da empresa,');
  console.log('o nosso banco tem só quem foi cadastrado para a Copa — e filtrar por ele');
  console.log('derrubaria gente da matriz que nunca entrou no app.');

  // ── 3. Distribuição das colunas candidatas ─────────────────────────────────
  if (candidatas.length) {
    linha('═');
    console.log('3. VALORES DE CADA COLUNA CANDIDATA');
    linha('═');
    for (const col of candidatas) {
      // Nome vem do information_schema, mas cita como identificador mesmo assim
      const ident = `"${col.replace(/"/g, '""')}"`;
      const { rows } = await pool.query(`
        SELECT COALESCE(${ident}::text, '(nulo)') AS valor,
               COUNT(*)::int AS qtd,
               MIN(COALESCE(display_name, corban_name, username)) AS exemplo
          FROM users GROUP BY 1 ORDER BY qtd DESC LIMIT 15
      `);
      console.log(`\n── ${col}`);
      for (const r of rows) {
        console.log(`   ${String(r.valor).padEnd(24)} ${String(r.qtd).padStart(4)} consultor(es)   ex: ${r.exemplo || '—'}`);
      }
    }
  }

  // ── 4. Estado da campanha ──────────────────────────────────────────────────
  linha('═');
  console.log('4. CAMPANHA — a coluna franquia_ids já existe?');
  linha('═');

  const { rows: camp } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'campaigns' AND column_name = 'franquia_ids'
  `);
  console.log(camp.length
    ? '  franquia_ids: existe (migration já rodou)'
    : '  franquia_ids: ainda não existe (a migration roda no próximo restart)');

  const { rows: mr } = await pool.query(`
    SELECT name, status, start_date::text, product_ids, require_same_day
      FROM campaigns ORDER BY id
  `);
  for (const c of mr) {
    console.log(`  ${c.name} — ${c.status} · ${c.start_date} · produto ${(c.product_ids || []).join(',')}` +
      `${c.require_same_day ? ' · mesmo dia' : ''}`);
  }
  console.log('');

  await pool.end();
})().catch(async err => {
  console.error('\nFALHOU:', err.message);
  try { await pool.end(); } catch { /* já fechado */ }
  process.exit(1);
});
