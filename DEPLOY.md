# Deploy — produção

> Levantado e verificado em 11/08/2026 conectando na VPS. O CLAUDE.md descreve
> dois outros modos (Hostinger Website Builder e split estático) — **nenhum dos
> dois é o que roda hoje**. O que vale é esta página.

## Como produção realmente roda

| Peça | Onde |
|------|------|
| Host | `191.252.159.244` (`grupodigital.vps-kinghost.net`), acesso `ssh root@191.252.159.244` |
| Código | `/opt/copa-gd`, branch `main` |
| Processo | **PM2**, app `copa-gd` → `bash -c npm start` → `node backend/src/server.js` |
| Porta | `3001`, com `SERVE_STATIC=true` — o **próprio Express serve o `frontend/dist`** |
| Proxy | nginx em 80/443, `/etc/nginx/sites-available/copa` → `127.0.0.1:3001` |
| Domínio | https://copa.grupodigitalsf.com.br |
| Banco | container Docker `postgres` (postgres:15), exposto em `55432` |
| Segredos | `/opt/copa-gd/.env` — **fica só no servidor**, não é versionado |

O app **não** roda em Docker. Só o Postgres roda. `docker compose up` na VPS não
sobe o Copa GD.

## Deploy

```bash
ssh root@191.252.159.244
cd /opt/copa-gd
git pull --ff-only
npm run build          # install:all + vite build → regenera frontend/dist
pm2 restart copa-gd
```

`npm run build` é obrigatório em **toda** mudança de frontend. O bundle é
estático e servido pelo Express: sem rebuild, `pm2 restart` sozinho reinicia a
API e continua entregando o JavaScript antigo. Foi exatamente isso que fez a
Copa GD 2026 aparecer com a escada da Missão Resgate mesmo depois do backend
novo estar no ar.

## Verificação

```bash
pm2 describe copa-gd | grep -E "status|restarts"
curl -s http://127.0.0.1:3001/api/health
pm2 logs copa-gd --lines 40 --nostream | grep -E "\[Env\]|Congelamento|Ranking GD"
```

O que se espera:

```
{"status":"ok","mode":"fullstack","serveStatic":true,"distExists":true,"nodeEnv":"production"}
🏆 Ranking GD rodando em http://0.0.0.0:3001 (API + frontend)
[Env] ✅ todas as variáveis esperadas estão definidas
[Scheduler] 🧊 Congelamento de campanhas agendado (00:05)
```

`mode: "api"` em vez de `fullstack` significa `frontend/dist` ausente — faltou o
`npm run build`. Qualquer `[Env] ❌` ou `⚠️` diz qual variável sumiu do `.env` e
o que se perde com ela (`backend/src/config/validateEnv.js`).

Conferência funcional, com o placar de uma campanha encerrada:

```bash
T=$(curl -s -X POST http://127.0.0.1:3001/api/auth/login \
      -H "Content-Type: application/json" \
      -d '{"username":"admin","password":"SENHA"}' | jq -r .token)
curl -s http://127.0.0.1:3001/api/campaigns/2/board -H "Authorization: Bearer $T" | jq '{legacy, frozen}'
```

## Rollback

```bash
cd /opt/copa-gd
git log --oneline -5
git checkout <commit-bom> && npm run build && pm2 restart copa-gd
```

Voltar o código **não desfaz migration nem dado**. As migrations só adicionam
coluna (`ADD COLUMN IF NOT EXISTS`), então código antigo convive com schema
novo — ele ignora o que não conhece. Já um placar congelado (`campaign_results`)
é dado: rollback não o apaga, e código anterior a `920ec05` lê esse snapshot pelo
ramo quebrado, renderizando "faltam undefined". Se precisar voltar para antes
disso, apague as linhas da campanha em `campaign_results` também.

## Armadilhas

**O `.env` local não pode apontar para o banco de produção.** Já apontou, e um
teste local acabou congelando a campanha real. O `docker-compose.yml` cai no
Postgres do container quando `DATABASE_URL` não está definida — deixe assim em
dev.

**O `.env` é gitignored e não tem backup.** Uma reescrita do arquivo derruba um
segredo em silêncio. Antes de mexer: `cp .env .env.save`. O
`validateEnv.js` avisa na subida, mas só depois do estrago.

**Não existe CI.** `git push` não faz deploy; alguém precisa rodar os comandos
acima. O commit em produção é o que `git log --oneline -1` disser em
`/opt/copa-gd`, não o que está no GitHub.

**Depois de deploy que mexa em campanha encerrada**, considere o botão
**🧊 Recongelar** no painel: o snapshot pode ter sido gerado pela API antiga se
o congelamento rodou de um ambiente sem `NEWCORBAN_PROPOSALS_TOKEN`.
