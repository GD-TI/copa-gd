# Copa GD 2 — Guia para o Claude

> **REGRA OBRIGATÓRIA**: Sempre que uma regra de negócio, bug fix, endpoint, ou comportamento do sistema for alterado, documentar aqui na seção correspondente antes de encerrar a tarefa.

---

## Stack

| Camada | Tecnologia | Porta |
|--------|-----------|-------|
| Backend | Node.js 20 + Express | `PORT` (env) |
| Frontend | React + Vite + Tailwind | Servido pelo Express em produção |
| Banco | PostgreSQL 16 | Externo (`DATABASE_URL`) |
| Infra local | Docker Compose | — |
| Infra produção | Website Builder Node.js | App única (`npm run build` + `npm start`) |

**Docker local:** `docker compose build backend` → `docker compose up -d backend`  
**Nunca** usar `docker compose up --build` (causa "file already closed"). Sempre separar build e up.

**Website Builder Node.js:** ver seção [Deploy — Hostinger / Website Builder](#deploy--hostinger--website-builder-nodejs) e arquivo `website-builder.json`.

### Arquivos de infra na raiz

| Arquivo | Função |
|---------|--------|
| `package.json` | `npm run build` + `npm start` (monorepo) |
| `website-builder.json` | Parâmetros de referência para o painel |
| `.nvmrc` | Node 20 |
| `Procfile` | `web: npm start` (Heroku/Railway) |
| `.env.example` | Template de variáveis (produção e Docker) |
| `.gitignore` | Ignora `node_modules/`, `frontend/dist/`, `.env`, `backend/uploads/` |

---

## Autenticação

- JWT via cookies/localStorage: `copa_token` e `copa_user`
- Admin padrão: `admin` / `admin2026`
- Role `admin` tem acesso a todos os endpoints

### Login do consultor (NewCorban)

- O consultor entra com o **mesmo login do NewCorban** (ex: `alessandro.ti`) — não existe mais username separado no app
- **Não há auto-cadastro público** — o admin pré-cadastra o jogador
- Login aceita `username` ou `corban_username` no banco (`POST /api/auth/login`)

### Primeiro acesso (definir senha)

1. Admin cadastra via `POST /api/admin/users` com `{ corban_username, group_id? }` — sem senha
2. Backend busca o usuário no NewCorban (`findUserByUsername`), grava `username = corban_username`, `needs_password_setup = true` e hash placeholder
3. Consultor abre `/login` → informa login NewCorban → `GET /api/auth/check-user?username=`
4. Se `needs_password_setup: true` → tela de definir senha → `POST /api/auth/setup-password` → retorna token (auto-login)
5. Se `needs_password_setup: false` → tela de senha normal

### Endpoints de auth

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/login` | — | Login; retorna 403 + `needs_password_setup` se primeiro acesso |
| POST | `/api/auth/setup-password` | — | Define senha no 1º acesso |
| GET | `/api/auth/check-user?username=` | — | Verifica cadastro e se precisa definir senha |
| GET | `/api/auth/lookup-corban?username=` | — | Busca usuário no NewCorban (usado pelo admin) |
| GET | `/api/auth/me` | JWT | Dados do usuário logado + grupo |

### Removido

- `POST /api/auth/register` — substituído por cadastro admin + `setup-password`

---

## Gestão de Equipes (somente Admin)

> Antes o vendedor criava/entrava/saía de grupos em `ShellMyGroup.jsx`. Agora **toda gestão é do admin**.

### Comportamento do jogador

- `ShellMyGroup.jsx`: **somente leitura** — mostra equipe atribuída e integrantes (`GET /api/groups/:id`)
- Se não estiver em equipe: mensagem para solicitar ao administrador
- Endpoints bloqueados para jogador:
  - `POST /api/groups/:id/join` → 403
  - `POST /api/groups/:id/leave` → 403
  - `POST /api/groups` → 403 (apenas admin cria equipes)

### Painel admin — `ShellConfig.jsx`

Seção **"Equipes e Jogadores"** (`ShellAdminTeams.jsx`):

| Ação | UI | API |
|------|-----|-----|
| Cadastrar jogador | Busca login NewCorban + equipe opcional | `POST /api/admin/users` |
| Criar equipe | Nome + foto opcional (📷) | `POST /api/admin/groups` (multipart) |
| Alterar foto da equipe | Clique no avatar na lista | `PUT /api/groups/:id` (multipart, admin) |
| Desativar equipe | 🗑️ na lista | `DELETE /api/admin/groups/:id` |
| Ver/adicionar/remover membros | Expandir equipe na lista | `GET/POST/DELETE /api/admin/groups/:id/members` |
| Metas R$ por equipe | Tabela "Metas de Valor Referência" | `PUT /api/settings/group-goals` |
| Meta de pontos (barra telão) | Coluna "Meta de Pontos" na mesma tabela | `PUT /api/settings/group-goals` (`goal_points`) |

- Máximo **5 membros** por equipe (validado no backend)
- Adicionar membro faz upsert em `group_memberships` — move jogador de outra equipe se necessário
- Jogador com `needs_password_setup = true` aparece com tag "aguardando 1º acesso" na lista de membros
- Fotos das equipes em **`groups.photo_data`** (BYTEA no PostgreSQL) — persistem no redeploy da Hostinger
- URL pública: `/api/groups/:id/photo` (gravada em `photo_url`)
- Upload via multer em memória (`groupPhotoStorage.js`); máx. 5 MB, só imagens
- Fotos antigas em `/uploads/groups/` (disco) ainda funcionam em dev; em produção reenviar após deploy

### Endpoints admin — equipes e usuários

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| POST | `/api/admin/groups` | `name` + `photo` (multipart) | Criar equipe |
| PUT | `/api/groups/:id` | `photo` (multipart) | Atualizar foto (admin ou capitão) |
| DELETE | `/api/admin/groups/:id` | — | Desativar equipe (`active = false`) |
| GET | `/api/admin/groups/:id/members` | — | Listar membros |
| POST | `/api/admin/groups/:id/members` | `{ user_id }` | Adicionar/mover jogador |
| DELETE | `/api/admin/groups/:id/members/:userId` | — | Remover jogador |
| POST | `/api/admin/users` | `{ corban_username, group_id? }` | Cadastrar jogador (sem senha) |
| POST | `/api/admin/users/:id/move-group` | `{ group_id }` | Mover jogador (legado; UI usa members) |
| PUT | `/api/settings/group-goals` | `{ goals: [{ group_id, daily_goal_value, weekly_goal_value, goal_points }] }` | Metas por equipe |

---

## Pontos das Regras (configurável)

> Valores padrão abaixo; admin pode alterar em **ShellConfig → Pontos por Regra**.

### Tabela `scoring_rules`

```sql
rule_name VARCHAR(50) PRIMARY KEY,
label, description, icon,
base_points NUMERIC NOT NULL
```

### Valores padrão (seed em `seed.js`)

| rule_name | base_points | Observação |
|-----------|-------------|------------|
| META_DIA | 5 | × multiplier em dia de jogo |
| META_SEMANA | 10 | × multiplier se semana tem dia de jogo |
| CONVERSAO | 5 | |
| INDICACAO | 10 | **por lote** de 5 contratos pagos |
| CONTRATO_10K | 5 | **por contrato** > R$ 10.000 |
| GOL_DE_PLACA | 15 | competitiva diária |
| TORCIDA_ORGANIZADA | 20 | |
| ARTILHEIRO | 15 | competitiva diária |

### Implementação

- `backend/src/services/scoringRules.js` — `getRulePointsMap()` com cache 60s; `invalidateRuleCache()` após PUT
- `scoring.js` usa `rulePts.META_DIA`, `rulePts.ARTILHEIRO`, etc. em vez de números fixos
- Alterar pontos **não recalcula** eventos já gravados — admin deve disparar "Calcular" para reprocessar

### Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/settings/scoring-rules` | JWT | Lista regras com `base_points` |
| PUT | `/api/settings/scoring-rules` | admin | `{ rules: [{ rule_name, base_points }] }` |
| GET | `/api/scores/rules` | JWT | Mesma fonte (banco) + regra AJUSTE_ADMIN |

### Migrations (`seed.js`)

- `CREATE TABLE IF NOT EXISTS scoring_rules` + insert dos defaults com `ON CONFLICT DO NOTHING`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_password_setup`
- `ALTER TABLE groups ADD COLUMN IF NOT EXISTS goal_points`

---

## Atualizações em Tempo Real (SSE)

- Endpoint: `GET /api/events/stream` — sem autenticação (só notifica, dados vêm de endpoints autenticados)
- Backend: `backend/src/routes/events.js` — mantém Set de clientes conectados + função `broadcast(event, data)`
- O `broadcast('scores_updated', {ts})` é chamado:
  - Após cada rodada do cron (`scheduler.js`)
  - Após cálculo manual pelo admin (`scores.js`)
- Frontend: `EventSource('/api/events/stream')` em `ShellRanking.jsx` — reconecta automaticamente em caso de queda
- Fallback: `setInterval` de 5 minutos caso SSE não funcione
- Vite proxy: `timeout: 0` no `/api` para suportar conexões longas

---

## APIs Externas (NewCorban)

### Propostas
```
POST https://api.newcorban.com.br/api/propostas/
Body: {
  auth: { username: "botapi", password: "api@bot321", empresa: "grupodigital" },
  requestType: "getPropostas",
  filters: {
    data: { tipo: "cadastro", startDate, endDate },
    vendedor: [corban_id_1, corban_id_2, ...]  // opcional
  }
}
```
Retorno: objeto keyed por ID de proposta. `datas.pagamento` não-null = pago. `vendedor_id` = corban_id do vendedor.

### Ranking (para qtd_propostas do dia — TORCIDA_ORGANIZADA)
```
GET https://server.newcorban.com.br/system/ranking.php?action=performance&i=BASE64
Authorization: Bearer <token v2>
```
Token v2: `POST https://apiv2.newcorban.com.br/api/v2/auth/login`

### Cache
- TTL: 3 minutos em memória (`_cache` Map em `externalApi.js`)
- Inflight dedup: se a mesma key já está em andamento, aguarda a Promise existente
- Chave: `proposals:startDate:endDate:corbanIds_sorted`

---

## Banco de Dados — Tabelas Importantes

### `score_events`
```sql
UNIQUE(group_id, event_date, rule_name)
```
Upsert idempotente. `event_date` varia por tipo de regra (ver seção Regras).

### `campaign_settings`
- `start_date`: início da campanha. Usado para filtrar `score_events` no leaderboard e para buscar propostas.
- Leaderboard só conta eventos com `event_date >= start_date`.

### `users`
- `corban_id`: mapeia para `vendedor_id` nas propostas da NewCorban
- `corban_username`: login NewCorban — usado como username de acesso ao app
- `needs_password_setup`: `true` até o consultor definir senha no primeiro acesso

### `scoring_rules`
- Pontos base configuráveis por regra (`base_points`)
- PK: `rule_name` (META_DIA, ARTILHEIRO, etc.)

### `groups`
- `goal_points`: meta de pontos da equipe — usado para a barra de progresso no ShellRanking/Telão. Configurável via ShellConfig (aba Configuração). Default 0 = sem barra de progresso.
- `daily_goal_value`, `weekly_goal_value`: metas em R$ por equipe (definidas pelo admin)

### `point_adjustments`
- Ajustes manuais do admin. Incluídos no total do leaderboard E no `members/points` (retornados no campo `adjustments`).
- Endpoints: `GET /api/admin/groups/:id/points`, `POST /api/admin/groups/:id/points` `{ points, reason }`, `DELETE /api/admin/adjustments/:id`
- UI: seção "⚖️ Ajuste Manual de Pontos" na aba Configuração do Shell (admin)

### `daily_calculations`
- Rastreia quais datas já foram calculadas pelo cron
- `UNIQUE(calculation_date)`
- Usado por `scoring.js` para pular dias passados já processados (modo cron)
- Admin "Calcular" define `triggered_by = userId` → recalcula tudo mesmo que já esteja em `daily_calculations`

### Inicialização do banco — `schema.sql` vs `seed.js`

> **Não confundir** login do **PostgreSQL** (`DATABASE_URL`) com login do **app** (`admin` / consultores na tabela `users`).

| Script | Quando roda | O que faz |
|--------|-------------|-----------|
| `backend/src/db/schema.sql` | Docker: 1ª subida do container Postgres. **Produção: manual 1×** | Cria todas as tabelas, índices, triggers |
| `backend/src/db/seed.js` | Toda subida do backend (`server.js`, +2s) | Admin padrão, migrations leves, `scoring_rules`, campanha padrão |

**O `seed.js` NÃO substitui o `schema.sql`.** Ele assume que `users` já existe. Banco vazio sem schema → erro `42P01 relation "users" does not exist`.

**Credenciais PostgreSQL:**

| Ambiente | Onde obter |
|----------|------------|
| Docker local | `docker-compose.yml`: `copa_user` / `DB_PASSWORD` (default `copa_pass_2026`) / DB `copa_gd` |
| Hostinger / Neon / servidor externo | Painel do provedor — **não** estão no `schema.sql` |

**`DATABASE_URL` externa:** pode apontar para PostgreSQL em outro servidor (VPS, Neon, rede da empresa). A Hostinger **não alcança** IPs privados (`192.168.x.x`) — só host público, VPN ou túnel. O Postgres **não sobe** no deploy Node.js da Hostinger (sem container sidecar); use banco gerenciado ou VPS + Docker Compose.

**Validação:** `backend/src/config/validateDb.js` — detecta `DATABASE_URL` com placeholder (`host`, `USUARIO:SENHA@`, etc.) antes do seed; mensagens claras no `seed.js` para `ENOTFOUND`, `ECONNREFUSED`, `42P01`.

**Senha com caracteres especiais na URL:** `#`, `+`, `*`, `@` etc. devem ser [URL-encoded](https://www.urlencoder.org/) na `DATABASE_URL`. Senha crua com `#` causa `TypeError: Invalid URL` no driver `pg`. Exemplo: senha `+abc-#7p*x` → `%2Babc-%237p%2Ax`. Com `psql` na VPS use aspas simples (sem encode).

**Colunas só no `seed.js` (não no `schema.sql`):** se o schema foi aplicado manualmente mas o seed falhou antes (ex.: `users` não existia), rodar o seed de novo após corrigir o banco **ou** executar manualmente:
```sql
ALTER TABLE groups ADD COLUMN IF NOT EXISTS daily_goal_value  NUMERIC DEFAULT 0;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS weekly_goal_value NUMERIC DEFAULT 0;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS goal_points       INTEGER DEFAULT 0;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_data BYTEA;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_mime VARCHAR(50);
-- + scoring_rules, campaign_settings (ver seed.js)
```
Erro típico: `column g.daily_goal_value does not exist`.

**Admin manual (se seed não rodou):**
```sql
INSERT INTO users (username, password_hash, role, display_name, needs_password_setup)
VALUES ('admin', '$2a$10$...', 'admin', 'Administrador', false)
ON CONFLICT (username) DO NOTHING;
```
Senha padrão `admin2026` — hash gerado por `bcrypt` no `seed.js` (10 rounds).

---

## Regras de Pontuação

> Pontos base vêm de `scoring_rules.base_points` (editável pelo admin).  
> Todas as regras usam `multiplier = 2` em dias de jogo do Brasil (`brazil_matches.double_points = true`).

| Regra | Pontos (padrão) | Tipo | event_date | Critério |
|-------|-----------------|------|------------|----------|
| META_DIA | 5 | Diária | `dateStr` (hoje) | Soma de `valor_referencia` dos contratos **pagos** hoje >= `daily_goal_value` |
| META_SEMANA | 10 | Semanal | `max(weekStart, campaignStart)` | `valor_referencia` da semana >= `weekly_goal_value` |
| CONVERSAO | 5 | Diária | `dateStr` | Taxa de pagamento hoje >= 25% |
| INDICACAO | 10/lote | Campanha acumulada | `campaignStart` | A cada 5 contratos pagos por indicação (`indicacao_id != null`) |
| CONTRATO_10K | 5/contrato | Campanha acumulada | `campaignStart` | Por contrato com `valor_referencia > 10000` |
| GOL_DE_PLACA | 15 | **Diária competitiva** | `dateStr` | Grupo com o maior contrato **pago** hoje entre todos os grupos |
| ARTILHEIRO | 15 | **Diária competitiva** | `dateStr` | Grupo com mais contratos **pagos hoje** entre todos os grupos |
| TORCIDA_ORGANIZADA | 20 | Diária | `dateStr` | Grupo com ≥5 membros, todos com >10 propostas hoje (via ranking) |

### Regras competitivas diárias (GOL_DE_PLACA e ARTILHEIRO)
- Comparam todos os grupos entre si
- `event_date = dateStr` (acumulam dia a dia — cada dia tem seu vencedor)
- Se um grupo perde o topo **durante o dia** (entre rodadas de 15min), o evento do dia é **deletado** do grupo que perdeu antes do novo ser inserido
- Camilla ganha GOL_DE_PLACA no dia 12 → 15 pts. João ganha no dia 13 → +15 pts para o grupo do João. Camilla **mantém** os 15 do dia 12.

### META_SEMANA — event_date clamped
- `event_date = weekStart >= campaignStart ? weekStart : campaignStart`
- Evita gravar eventos antes do início da campanha quando a campanha começa no meio da semana.

---

## Cálculo de Pontos (`scoring.js`)

- Roda a cada 15 minutos via cron (`scheduler.js`)
- Carrega pontos das regras via `getRulePointsMap()` no início de cada execução
- Busca propostas de **todo o período da campanha** (`campaignStart` → hoje) em **uma única chamada** (cacheada)
- **Itera sobre cada dia da campanha** e aplica as regras para aquele dia específico
- Dias passados: calculados apenas uma vez (skip via `daily_calculations`), exceto quando admin dispara force
- Hoje: sempre recalculado (dinâmico)
- Ao fim do dia: os dados ficam congelados naturalmente (o cron não atualiza dias passados no modo automático)
- Admin "Calcular" usa `triggeredBy = userId` → força recalcular todos os dias
- Para competitivas diárias: deleta eventos do dia de grupos não-vencedores **antes** do upsert (apenas hoje)

### Fluxo por dia
1. Filtra propostas pelo `datas.cadastro` daquele dia
2. Calcula META_DIA, CONVERSAO, GOL_DE_PLACA, ARTILHEIRO das propostas do dia
3. TORCIDA_ORGANIZADA: só hoje (depende do ranking em tempo real)
4. Após loop diário: META_SEMANA por semana; INDICACAO + CONTRATO_10K acumulado da campanha

---

## Endpoint `/api/groups/:id/members/points`

**Fonte de verdade: `score_events` no banco** (leitura direta, sem chamar NewCorban).

- Retorna eventos agrupados por `event_date` em ordem decrescente
- Cada dia tem: `date`, `events` (array de regras com ícone/label/pts/descrição), `daily_total`
- Também retorna `adjustments` (ajustes manuais), `total_points`, `adj_total`, `grand_total`
- **O total bate com o leaderboard** — ambos leem de `score_events`
- O dia de hoje mostra tag "ao vivo" pois ainda pode mudar até o cron rodar

---

## Leaderboard / Queries de Score

**BUG HISTÓRICO (corrigido):** Fazer JOIN entre `group_memberships` + `score_events` no mesmo SELECT multiplica os pontos pelo número de membros. **Solução:** usar `LATERAL JOIN` ou subqueries correlacionadas para score_events.

```sql
-- CORRETO
LEFT JOIN LATERAL (
  SELECT SUM(points) as total FROM score_events se
  WHERE se.group_id = g.id
    AND se.event_date >= (SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1)
) se_agg ON true

-- ERRADO (multiplica pontos por número de membros)
LEFT JOIN score_events se ON g.id = se.group_id  -- com LEFT JOIN group_memberships também
```

O leaderboard **sempre filtra** `score_events` pelo período da campanha (`event_date >= campaign.start_date`).

---

## Frontend

### Tema (light / dark)

- Cookie `copa_theme` (`light` | `dark`), validade 1 ano, `SameSite=Lax`
- Script inline em `index.html` aplica o tema **antes** do React (evita flash ao recarregar)
- `utils/theme.js` — `readThemeCookie`, `writeThemeCookie`, `applyTheme`
- Toggle em `Shell.jsx` → salva cookie + `document.documentElement.dataset.theme` + `colorScheme`
- Campos do painel usam `.field-input` com variáveis `--input-bg`, `--input-border` (contraste no modo claro)

### Shell (`components/Shell.jsx`)

| Página | Role | Arquivo | Função |
|--------|------|---------|--------|
| Ranking | todos | `ShellRanking.jsx` | Placar e telão |
| Meu Grupo | `player` | `ShellMyGroup.jsx` | Visualização da equipe (somente leitura) |
| Configuração | `admin` | `ShellConfig.jsx` | Período, equipes, metas, regras, ajustes |

### Login (`pages/Login.jsx`)

- Fluxo em 3 passos: username NewCorban → (setup-password **ou** senha) → redirect `/`
- Removido toggle Cadastrar / auto-registro
- `setup-password` grava token e recarrega a página

### Configuração admin (`ShellConfig.jsx`)

Ordem das seções:
1. **Equipes e Jogadores** — `ShellAdminTeams.jsx`
2. **Pontos por Regra** — `ScoringRulesConfig` (inline)
3. **Período da Campanha**
4. **Metas de Valor Referência por Equipe (R$)** + Meta de Pontos
5. **Ajuste Manual de Pontos** — `PointAdjustments`

### Outros

- `main.jsx`: **sem** `React.StrictMode` (causava double-mount e double requests em dev)
- `useEffect` depende de `group?.id` (não do objeto `group`) para evitar re-renders por referência
- `MembersModal.jsx`: tab "Pontos do Grupo" mostra breakdown por regra com atribuição por membro ou "Time todo"

---

## Deploy — Hostinger / Website Builder Node.js

App **fullstack em um único processo**: Express serve API + arquivos estáticos do Vite (`frontend/dist`).

### Hostinger — preset e painel

| Campo | Valor |
|-------|--------|
| **Framework preset** | **Express.js** (não React/Vite — o Vite só gera o build; quem sobe é o Express) |
| **Node.js** | **20** |
| **Build** | `npm run build` |
| **Start** | `npm start` |
| **Entry file** | `backend/src/server.js` |
| **Raiz** | Repositório (`.`) |
| **Health check** | `GET /api/health` → `{ mode: "fullstack" }` se front servido |

Log esperado em produção: `🏆 Copa GD rodando em http://0.0.0.0:PORT (API + frontend)`.  
Se aparecer só `(API)`: falta `SERVE_STATIC=true` ou `frontend/dist` não foi gerado no build.

### Git → deploy

- Branch principal no GitHub costuma ser `main`; desenvolvimento pode estar em `master`
- `git push origin main` só envia a branch local `main` — se o código novo está em `master`, usar: `git push origin master:main`
- Fluxo: `git add .` → `git commit` → `git push` (commit obrigatório antes do push)

### Painel do host — parâmetros genéricos

| Campo | Valor |
|-------|--------|
| **Runtime** | Node.js **20** (`.nvmrc`) |
| **Raiz do app** | `/` (repositório) |
| **Comando de build** | `npm run build` |
| **Comando de start** | `npm start` |
| **Porta** | Variável `PORT` (definida pelo host) |
| **Health check** | `GET /api/health` |
| **Arquivo de referência** | `website-builder.json` |

### Fluxo de build

1. `npm run install:all` — dependências de `backend/` e `frontend/`
2. `npm run build --prefix frontend` — gera `frontend/dist`
3. `npm start` → `node backend/src/server.js`
4. Com `NODE_ENV=production` ou `SERVE_STATIC=true`, Express serve `frontend/dist` na mesma porta

### Variáveis de ambiente (painel)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NODE_ENV` | Sim | `production` |
| `PORT` | Sim | Injetada pelo host (não fixar 3001) |
| `DATABASE_URL` | Sim | PostgreSQL **externo** — host real, não placeholder `host` do `.env.example` |
| `JWT_SECRET` | Sim | Secret longo para JWT |
| `NEWCORBAN_USERNAME` | Sim | Login API v2 NewCorban |
| `NEWCORBAN_PASSWORD` | Sim | Senha API v2 |
| `SERVE_STATIC` | Recomendado | `true` — serve o React buildado |
| `NEWCORBAN_SUBDOMAIN` | Não | Default `grupodigital` |
| `NEWCORBAN_API_USERNAME` | **Sim** | Login para `POST /api/propostas/` — se os defaults `botapi`/`api@bot321` não funcionarem, o ranking fica zerado |
| `NEWCORBAN_API_PASSWORD` | **Sim** | Senha para `POST /api/propostas/` |
| `CORS_ORIGIN` | Não | Só se API e front em domínios diferentes |
| `HOST` | Não | Default `0.0.0.0` |
| `FOOTBALL_API_KEY` | Não | Calendário Copa (football-data.org) |

Template completo: `.env.example` na raiz.

**Exemplo `DATABASE_URL` (trocar pelos dados reais do painel):**
```
postgresql://copa_app:SenhaSemEspeciais@191.252.159.244:5432/copa_gd
```
Senha com `#`, `+`, `*` → URL encode (`#` → `%23`, `+` → `%2B`, `*` → `%2A`). Preferir usuário dedicado com senha simples (ex.: `copa_app`) em vez de reutilizar usuário do n8n.

### PostgreSQL externo (VPS) + app na Hostinger

| Etapa | O que fazer |
|-------|-------------|
| Firewall VPS | Liberar **5432/TCP inbound** para o IP de **saída** da Hostinger (não o IP da VPS do banco) |
| IPv6 | `curl -s ifconfig.me` no SSH da Hostinger pode retornar IPv6 — liberar também no firewall e `pg_hba.conf` |
| `postgresql.conf` | `listen_addresses = '*'` (ou IP específico) |
| `pg_hba.conf` | `host copa_gd copa_app IP_HOSTINGER/32 scram-sha-256` |
| Banco | `CREATE DATABASE copa_gd`; dono `copa_app` via `ALTER DATABASE ... OWNER TO` + `REASSIGN OWNED BY` |
| Schema | `sudo -u postgres psql -d copa_gd -f schema.sql` **uma vez** |
| Teste (VPS) | `PGPASSWORD='...' psql -h 127.0.0.1 -U copa_app -d copa_gd -c "SELECT 1"` |
| Teste (Hostinger SSH) | `timeout 5 bash -c 'echo > /dev/tcp/HOST/5432'` — `nc` pode não existir |

**Diagnóstico de erros comuns:**

| Log | Causa |
|-----|--------|
| `Invalid URL` | Senha com `#` ou URL malformada |
| `password authentication failed` | Usuário/senha errados ou encode incorreto |
| `relation "users" does not exist` | Falta `schema.sql` |
| `column g.daily_goal_value does not exist` | Falta migrations do `seed.js` |
| `ENOTFOUND host` | `DATABASE_URL` ainda com placeholder do `.env.example` |

### Banco na primeira subida

1. Criar database PostgreSQL vazio no provedor (Hostinger, Neon, servidor próprio…)
2. Executar **`backend/src/db/schema.sql` uma vez** (pgAdmin, DBeaver, SQL do painel)
3. Configurar `DATABASE_URL` no painel e redeploy
4. Na subida, **`seed.js`** automaticamente:
   - Cria admin `admin` / `admin2026`
   - Migrations: colunas em `groups`/`users`, `scoring_rules`, `campaign_settings`
   - Campanha e regras de pontos padrão

**Docker local:** passo 2 é automático (`schema.sql` em `docker-entrypoint-initdb.d`).

### O que NÃO roda no Hostinger Node.js

- `docker compose` com container Postgres — use banco externo ou migre para **VPS + Docker**
- Postgres na rede local (`192.168.x.x`) sem IP público/VPN — a nuvem não alcança

### `server.js` (produção)

- Carrega `.env` da raiz e `backend/.env`
- `HOST=0.0.0.0`, `PORT` do ambiente
- `SERVE_STATIC=true` ou `NODE_ENV=production` → serve `frontend/dist` + fallback SPA (só se `dist` existir)
- Valida `DATABASE_URL` via `validateDb.js` antes do seed; se inválida, loga aviso e pula seed
- Log de startup: `NODE_ENV`, `SERVE_STATIC`, `dist=ok|AUSENTE`
- `/api/health` retorna:
  ```json
  { "status": "ok", "mode": "fullstack|api", "serveStatic": true, "distExists": true, "distPath": "...", "nodeEnv": "production" }
  ```
- Se `SERVE_STATIC` sem `dist`: `GET /` → 503 JSON com hint para rodar `npm run build`
- Se modo API apenas: `GET /` → 503 com hint `NODE_ENV=production` + `SERVE_STATIC=true`

### Desenvolvimento local (sem website builder)

- Docker Compose: frontend `:3000` + backend `:3001` (proxy Vite em `/api`)
- Ou: `npm run dev:backend` + `npm run dev:frontend` em terminais separados

---

## Variáveis de Ambiente (backend)

> Produção: painel do host ou `.env` na **raiz**. O `server.js` carrega `../../.env` e `backend/.env`.

```env
NODE_ENV=production
PORT=3000
SERVE_STATIC=true
DATABASE_URL=postgresql://...
JWT_SECRET=<secret>
NEWCORBAN_USERNAME=<login v2>
NEWCORBAN_PASSWORD=<senha v2>
NEWCORBAN_SUBDOMAIN=grupodigital
NEWCORBAN_API_USERNAME=botapi
NEWCORBAN_API_PASSWORD=api@bot321
CORS_ORIGIN=          # opcional se SERVE_STATIC=true
FOOTBALL_API_KEY=     # opcional
HOST=0.0.0.0
```

**Docker Compose local (.env na raiz):**

```env
DB_PASSWORD=copa_pass_2026
# Se DATABASE_URL não definida, docker-compose usa postgres local (fallback automático)
# Para apontar ao banco de produção (Hostinger) em dev, definir:
# DATABASE_URL=postgresql://copa_app:SenhaReal@191.252.159.244:55432/copa_gd
JWT_SECRET=...
NEWCORBAN_USERNAME=...
NEWCORBAN_PASSWORD=...
VITE_API_URL=http://localhost:3001
```

---

## Git e `.gitignore`

### Ignorados (não commitar)

- `node_modules/` — todas as pastas (raiz, `backend/`, `frontend/`)
- `frontend/dist/` — build de produção
- `.env` — segredos
- `backend/uploads/` — fotos de grupo em dev

### Versionar

- `package-lock.json` em cada pacote — garante build reproduzível no Hostinger

---

## Histórico de Bugs Corrigidos

| Data | Bug | Fix |
|------|-----|-----|
| Jun/26 | Leaderboard multiplicava pontos pelo nº de membros | LATERAL JOIN em todas as queries de score |
| Jun/26 | GOL_DE_PLACA/ARTILHEIRO usavam `event_date = campaignStart` | Mudado para `event_date = dateStr` (diário) |
| Jun/26 | Regras competitivas comparavam todo o período | Agora comparam apenas propostas do dia |
| Jun/26 | GOL_DE_PLACA contava qualquer contrato do dia | Corrigido: só conta contratos **pagos** hoje |
| Jun/26 | META_SEMANA gravada antes do início da campanha | `event_date = max(weekStart, campaignStart)` |
| Jun/26 | Score zerava quando 2 requests concorrentes à NewCorban | Inflight dedup com Promise compartilhada |
| Jun/26 | Double request no frontend (StrictMode + object reference) | Remover StrictMode; depender de `group?.id` |
| Jun/26 | META_DIA contava propostas não pagas na soma de valor | Corrigido: apenas contratos **pagos** somam para META_DIA |
| Jun/26 | `esteira.php` sempre retornava erro | Substituído por `POST /api/propostas/` |
| Jun/26 | `goal_points` ausente nos endpoints de ranking/leaderboard | Adicionado `g.goal_points` ao SELECT + GROUP BY em `groups.js` (GET / e /ranking) e `scores.js` (leaderboard) |
| Jun/26 | CONVERSAO ausente no endpoint `/api/scores/rules` | Adicionada regra CONVERSAO à lista |
| Jun/26 | Nenhuma UI para configurar `goal_points` por equipe | `ShellConfig.jsx` agora exibe coluna "Meta de Pontos"; `/api/settings/group-goals` agora salva `goal_points` |
| Jun/26 | `members/points` mostrava 0 pts aos fins de semana | Endpoint refeito para ler de `score_events` (mesmo que leaderboard) em vez de recalcular da API |
| Jun/26 | `String(pgDateObject).slice(0,10)` retornava data errada | PostgreSQL retorna objetos Date, não strings. Usar `new Date(val).toISOString().slice(0,10)`. Afetou: `campaignStart` em `members/points` e o agrupamento `event_date` no mesmo endpoint (linha 179). |
| Jun/26 | Pontos históricos não eram gravados (só calculava o dia atual) | `scoring.js` refeito para iterar todos os dias da campanha; backfill automático; dias passados congelados |
| Jun/26 | Gestão de equipes pelo vendedor | Movida para admin: criar/deletar equipes, add/remover membros, metas por equipe |
| Jun/26 | Auto-cadastro com username separado | Admin cadastra por login NewCorban; consultor define senha no 1º acesso |
| Jun/26 | Pontos das regras hardcoded | Tabela `scoring_rules` + UI admin (`ScoringRulesConfig`) + `scoringRules.js` |
| Jun/26 | `POST /api/auth/register` expunha auto-cadastro | Removido; fluxo admin + `setup-password` + `check-user` |
| Jun/26 | Jogador geria equipe em `ShellMyGroup` | `ShellMyGroup` somente leitura; gestão em `ShellAdminTeams` |
| Jun/26 | Tema sumia ao recarregar | Cookie `copa_theme` + script em `index.html` + `utils/theme.js` |
| Jun/26 | Campos da Config ilegíveis no modo claro | `--input-bg`, `--input-border` em `shell.css`; estilos para `select`/`date` |
| Jun/26 | Deploy Hostinger sem monorepo | `package.json` raiz, `server.js` serve `frontend/dist`, `website-builder.json` |
| Jun/26 | `DATABASE_URL` com placeholder `host` | `validateDb.js` + mensagens no `seed.js`; doc em `.env.example` |
| Jun/26 | `Invalid URL` com senha contendo `#` | URL-encode na `DATABASE_URL`; doc em CLAUDE.md |
| Jun/26 | Fotos de equipe sumiam no redeploy Hostinger | Armazenamento em `groups.photo_data` (PostgreSQL) + `GET /api/groups/:id/photo` |
| Jun/26 | `GET /api/groups/:id` members sem `corban_username` | Adicionado `u.corban_username` ao SELECT de membros em `groups.js` |
| Jun/26 | `GET /api/groups/:id` score não filtrado por `campaign.start_date` | Adicionado filtro `event_date >= (SELECT start_date FROM campaign_settings ...)` |
| Jun/26 | `GET /api/groups/:id` query à tabela legacy `group_goals` (vazia) | Removida query e campo `goal` da resposta; metas já estão em `...group` (grupos.daily/weekly_goal_value) |
| Jun/26 | Seed falhava ao `ALTER TABLE` quando `copa_app` não é owner | Cada migration agora em try-catch individual — silencia permissão se colunas já existem |
| Jun/26 | `docker-compose.yml` DATABASE_URL hardcoded (sem override por .env) | Mudado para `${DATABASE_URL:-...}` para permitir apontar para Hostinger em dev |
| Jun/26 | Ranking zerado — credenciais `NEWCORBAN_API_USERNAME`/`_PASSWORD` ausentes no `docker-compose.yml` | `botapi`/`api@bot321` inválidos para essa conta; adicionados `NEWCORBAN_API_USERNAME` e `NEWCORBAN_API_PASSWORD` ao docker-compose env e ao `.env`; `getProposals` agora lança erro quando a API retorna `{error: true}` em vez de silenciar |
| Jun/26 | `column daily_goal_value does not exist` após schema manual | Migrations do `seed.js` não rodaram; SQL manual ou redeploy após schema |
| Jun/26 | `/api/health` pouco diagnóstico | Retorna `serveStatic`, `distExists`, `distPath`, `nodeEnv` |
| Jun/26 | Confusão schema vs credenciais Postgres | Documentado: `schema.sql` = tabelas; credenciais vêm do provedor/Docker |
| Jun/26 | `git push main` não enviava código novo | Código em `master` ≠ `main`; usar `git push origin master:main` |
