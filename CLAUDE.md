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
- Role `admin` (master) tem acesso a todos os endpoints e configurações globais
- Role `team_admin` (sub-admin): acesso apenas às equipes em `admin_team_scopes`
- Role `player`: ranking + meu grupo (leitura)

### Sub-admins (`team_admin`)

| Pode | Não pode |
|------|----------|
| Gerenciar jogadores das equipes atribuídas | Criar/desativar equipes |
| Metas R$ e meta de pontos das suas equipes | Período da campanha |
| Ajuste manual de pontos das suas equipes | Pontos das regras (`scoring_rules`) |
| Upload/remover foto das suas equipes | Recalcular toda a campanha |
| Cadastrar jogador (NewCorban) em equipe do escopo | Gerenciar outros sub-admins |
| | Calendário Copa / `brazil_matches` |

- Tabela `admin_team_scopes(user_id, group_id)` — PK composta
- Migration: `backend/src/db/migrations.js` → `migrateTeamAdminSupport()`
- Endpoints (master only): `GET/POST /api/admin/team-admins`, `PUT /api/admin/team-admins/:id`
- Login: username + senha definidos pelo master (não usa NewCorban)
- `GET /api/auth/me` retorna `managed_group_ids: number[]` para `team_admin`
- Middleware: `configAdminOnly` (admin + team_admin), `adminOnly` (só master), `requireGroupAccess` (rotas com `:id` de equipe)
- UI master: `ShellConfig` → seção **Sub-admins de Equipe**
- UI sub-admin: menu **Minhas Equipes** (`Shell.jsx`); `ShellConfig` sem período, regras e recálculo
- `PUT /api/settings/group-goals`: team_admin só atualiza equipes do seu escopo

**SQL manual (se `users_role_check` bloquear `team_admin`):** ver seção [Banco](#inicialização-do-banco--schemasql-vs-seedjs).

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

**Master (`admin`):** todas as seções abaixo + Sub-admins de Equipe.  
**Sub-admin (`team_admin`):** apenas Equipes e Jogadores, Metas por equipe e Ajuste Manual (filtrado pelo escopo).

Seção **"Equipes e Jogadores"** (`ShellAdminTeams.jsx`):

| Ação | UI | API |
|------|-----|-----|
| Cadastrar jogador | Busca login NewCorban + equipe opcional | `POST /api/admin/users` |
| Criar equipe | Nome + foto opcional (📷) | `POST /api/admin/groups` (multipart) |
| Alterar foto da equipe | Clique no avatar ou **📷 Enviar nova foto** (expandir equipe) | `PUT /api/admin/groups/:id/photo` (multipart) |
| Remover foto corrompida | **Remover foto antiga** na equipe expandida | `DELETE /api/admin/groups/:id/photo` |
| Desativar equipe | 🗑️ na lista | `DELETE /api/admin/groups/:id` |
| Ver/adicionar/remover membros | Expandir equipe na lista | `GET/POST/DELETE /api/admin/groups/:id/members` |
| Metas R$ por equipe | Tabela "Metas de Valor Referência" | `PUT /api/settings/group-goals` |
| Meta de pontos (barra telão) | Coluna "Meta de Pontos" na mesma tabela | `PUT /api/settings/group-goals` (`goal_points`) |

- Máximo **5 membros** por equipe (validado no backend)
- Adicionar membro faz upsert em `group_memberships` — move jogador de outra equipe se necessário
- Jogador com `needs_password_setup = true` aparece com tag "aguardando 1º acesso" na lista de membros
- **Mudança de equipe → recálculo automático:** ao cadastrar jogador em equipe, adicionar/remover/mover membro ou desativar jogador, o backend dispara `calculateScores(adminId)` em background (force) — recalcula **todos os dias da campanha** com a composição atual das equipes
- Fotos das equipes em **`groups.photo_data`** (BYTEA no PostgreSQL) — persistem no redeploy da Hostinger
- URL pública: `/api/groups/:id/photo` (gravada em `photo_url`)
- Upload via multer em memória (`groupPhotoStorage.js`); máx. 5 MB, só imagens
- Fotos antigas em `/uploads/groups/` (disco) — reenviar após deploy; ou `DELETE /api/admin/groups/:id/photo` + nova foto
- **Upload:** não definir `Content-Type` manualmente no axios com `FormData` (quebra o boundary do multipart)

### Endpoints admin — equipes e usuários

| Método | Rota | Body | Descrição |
|--------|------|------|-----------|
| POST | `/api/admin/groups` | `name` + `photo` (multipart) | Criar equipe |
| PUT | `/api/admin/groups/:id/photo` | `photo` (multipart) | Atualizar foto (admin) |
| DELETE | `/api/admin/groups/:id/photo` | — | Limpar foto corrompida/antiga |
| PUT | `/api/groups/:id` | `name` / `photo` (multipart) | Atualizar grupo (admin ou capitão) |
| DELETE | `/api/admin/groups/:id` | — | Desativar equipe (`active = false`) |
| GET | `/api/admin/groups/:id/members` | — | Listar membros |
| POST | `/api/admin/groups/:id/members` | `{ user_id }` | Adicionar/mover jogador |
| DELETE | `/api/admin/groups/:id/members/:userId` | — | Remover jogador |
| POST | `/api/admin/users` | `{ corban_username, group_id? }` | Cadastrar jogador (sem senha) |
| GET/POST/PUT | `/api/admin/team-admins` | ver body abaixo | CRUD sub-admins (master) |
| POST | `/api/admin/users/:id/move-group` | `{ group_id }` | Mover jogador (legado; UI usa members) |
| PUT | `/api/settings/group-goals` | `{ goals: [{ group_id, daily_goal_value, weekly_goal_value, goal_points }] }` | Metas por equipe |

**Body `POST /api/admin/team-admins`:** `{ username, password, display_name?, group_ids: [1,2,3] }`

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
| META_DIA_PLUS30 | 10 | Bônus: ≥ 130% da meta diária (mutualmente exclusivo — tier mais alto vence) |
| META_DIA_PLUS50 | 15 | Bônus: ≥ 150% da meta diária |
| META_DIA_PLUS100 | 20 | Bônus: ≥ 200% da meta diária (dobro) |
| META_SEMANA | 10 | × multiplier se semana tem dia de jogo |
| CONVERSAO | 5 | |
| INDICACAO | 10 | **por lote** de 5 contratos pagos com `origem` contendo "Indicação" |
| CONTRATO_10K | 5 | **por contrato** > R$ 10.000 |
| GOL_DE_PLACA | 15 | competitiva diária |
| TORCIDA_ORGANIZADA | 20 | |
| ARTILHEIRO | 15 | competitiva diária |

### Implementação

- `backend/src/services/scoringRules.js` — `getRulePointsMap()` com cache 60s; `invalidateRuleCache()` após PUT
- `scoring.js` usa `rulePts.META_DIA`, `rulePts.ARTILHEIRO`, etc. em vez de números fixos
- `utils/proposals.js` — `isIndicacaoProposal()` verifica `origem` contém "Indicação"; `filterPaidIndicacoes` só dias úteis
- Alterar pontos **não recalcula** eventos já gravados — admin deve disparar "Calcular" para reprocessar

### Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/settings/scoring-rules` | JWT | Lista regras com `base_points` |
| PUT | `/api/settings/scoring-rules` | admin | `{ rules: [{ rule_name, base_points }] }` |
| GET | `/api/scores/rules` | JWT | Mesma fonte (banco) + regra AJUSTE_ADMIN |
| GET | `/api/scores/individual-rankings` | JWT | Top 3: `melhor_vendedor` (por `total_valor`) e `rei_assistencias` (por `indicacao_count`); lê propostas pagas da NewCorban no período da campanha |

### Migrations (`seed.js` + `migrations.js`)

- `CREATE TABLE IF NOT EXISTS scoring_rules` + insert dos defaults com `ON CONFLICT`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_password_setup`
- `ALTER TABLE groups ADD COLUMN IF NOT EXISTS daily_goal_value, weekly_goal_value, goal_points, photo_data, photo_mime`
- `migrateTeamAdminSupport()` em `backend/src/db/migrations.js` — role `team_admin` + tabela `admin_team_scopes`
- `CREATE TABLE IF NOT EXISTS campaign_settings` + campanha padrão se vazia

---

## Atualizações em Tempo Real (SSE)

- Endpoint: `GET /api/events/stream` — sem autenticação (só notifica, dados vêm de endpoints autenticados)
- Backend: `backend/src/routes/events.js` — mantém Set de clientes conectados + função `broadcast(event, data)`
- O `broadcast('scores_updated', {ts})` é chamado:
  - Após cada rodada do cron (`scheduler.js`)
  - Após cálculo manual pelo admin (`scores.js`)
  - Após alteração de jogos do Brasil (`worldcup.js` → recálculo force)
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
- **Exceção:** dias em `brazil_matches` com `double_points=true` são **reprocessados** mesmo já processados (pontuação ×2 retroativa)
- Admin "Calcular" define `triggered_by = userId` → recalcula tudo (modo force)

### `brazil_matches`
- Calendário de jogos do Brasil (`match_date`, `opponent`, `stage`, `double_points`)
- `double_points = true` → aquele dia entra no set `doubleDays` no `scoring.js`
- Cadastro: `POST /api/worldcup/matches`, sync `POST /api/worldcup/sync` (master)
- **Sync automático na startup** (`server.js` chama `syncMatchesFromApi` após seed — sem recálculo)
- **Sync manual via botão admin** → recalcula apenas se houve mudanças (`changed > 0`)
- **Alterar/remover jogos dispara recálculo force** automático (`triggerBrazilMatchRecalc` em `worldcup.js`)
- API: football-data.org `GET /v4/teams/764/matches?season=2026&competitions=WC` (Brasil ID=764)
- Descrição gerada: `"Brasil x Morocco · Fase de Grupos"` (português)
- Stages mapeados: `GROUP_STAGE→group`, `LAST_16→round_of_16`, `QUARTER_FINALS→quarter`, `SEMI_FINALS→semi`, `FINAL→final`, `THIRD_PLACE→third_place`
- `ON CONFLICT (match_date) DO UPDATE WHERE IS DISTINCT FROM` — só atualiza se dados mudaram (evita recálculo desnecessário)
- **Anti-orphan:** antes de cada INSERT, deleta registros do mesmo `opponent+stage` em datas diferentes (evita duplicatas quando fuso horário corrige a data)
- **BUG HISTÓRICO (corrigido):** football API retorna `utcDate` em UTC; jogos noturnos nos EUA cruzam meia-noite UTC → data ficava errada (ex: Haiti `2026-06-20T00:30Z` = `19/06 21:30 BRT`). Corrigido: `toBrazilDate(utcStr)` converte UTC → UTC-3 antes de extrair a data
- Consultar dias ativos:
  ```sql
  SELECT match_date::text, opponent, double_points
  FROM brazil_matches
  WHERE match_date >= (SELECT start_date FROM campaign_settings ORDER BY id DESC LIMIT 1)
  ORDER BY match_date;
  ```

### `admin_team_scopes`
- `(user_id, group_id)` — equipes que cada `team_admin` pode gerenciar
- Criada por `migrateTeamAdminSupport()` ou SQL manual (ver deploy)

### `users.role`
- Valores: `player`, `admin`, `team_admin`
- Constraint: `users_role_check CHECK (role IN ('player', 'admin', 'team_admin'))`

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

**Sub-admins (`team_admin`) — erro `users_role_check`:**
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('player', 'admin', 'team_admin'));

CREATE TABLE IF NOT EXISTS admin_team_scopes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, group_id)
);
```
Rodar como **owner** do banco (`postgres` ou dono da tabela `users`). O usuário `copa_app` pode não ter permissão para `ALTER TABLE` — nesse caso use o superusuário na VPS.

**Admin manual (se seed não rodou):**
```sql
INSERT INTO users (username, password_hash, role, display_name, needs_password_setup)
VALUES ('admin', '$2a$10$...', 'admin', 'Administrador', false)
ON CONFLICT (username) DO NOTHING;
```
Senha padrão `admin2026` — hash gerado por `bcrypt` no `seed.js` (10 rounds).

---

## Regras de Pontuação

### Quais dias entram na campanha

| Camada | Regra | Implementação |
|--------|--------|---------------|
| Período | `campaign_settings.start_date` → hoje | `scoring.js` + leaderboard |
| Dias úteis | **Segunda a sexta** apenas | `backend/src/utils/businessDays.js` |
| Fim de semana | Não pontua, propostas ignoradas | `isBusinessDay()`, `filterByWeekdayCadastro`, `isWeekdayPaid` |
| ×2 Brasil | Datas em `brazil_matches` com `double_points=true` | Set `doubleDays` no `scoring.js` |

**Proposta válida:** cadastro (`datas.cadastro` ou `inclusao`) em dia útil.  
**Pago válido:** além disso, `datas.pagamento` também em dia útil.

**Não há lista fixa de jogos no código** — só o que estiver em `brazil_matches` no banco.

> Pontos base vêm de `scoring_rules.base_points` (editável pelo admin master).  
> **Pontos em dobro (×2)** em dias com jogo do Brasil (`brazil_matches.double_points = true`):
> - Regras **diárias** (em dia útil): META_DIA, CONVERSAO, GOL_DE_PLACA, ARTILHEIRO, TORCIDA_ORGANIZADA
> - **META_SEMANA**: ×2 se **qualquer dia útil** da semana tiver jogo do Brasil
> - **INDICACAO** e **CONTRATO_10K** (campanha acumulada): **não** dobram
> - Campo `score_events.is_double_points` + breakdown em `/api/groups/:id/members/points`
> - Breakdown UI: badge `🇧🇷 ×2` no dia, `base_points`, `multiplier`, `brazil_match` (adversário)
> - **Retroativo:** dias em `brazil_matches` são recalculados mesmo após `daily_calculations`; alterar jogos ou "Recalcular campanha" aplica ×2 no passado; TORCIDA retroativa busca ranking histórico no force recalc

| Regra | Pontos (padrão) | Tipo | event_date | Critério |
|-------|-----------------|------|------------|----------|
| META_DIA | 5 | Diária | `dateStr` (hoje) | Soma de `valor_referencia` dos contratos **pagos** hoje >= `daily_goal_value` |
| META_DIA_PLUS30 | 10 | Diária (bônus) | `dateStr` | Bônus exclusivo: valor ≥ 130% da meta; tier mais alto vence (PLUS30 < PLUS50 < PLUS100) |
| META_DIA_PLUS50 | 15 | Diária (bônus) | `dateStr` | Bônus exclusivo: valor ≥ 150% da meta |
| META_DIA_PLUS100 | 20 | Diária (bônus) | `dateStr` | Bônus exclusivo: valor ≥ 200% da meta (dobro) |
| META_SEMANA | 10 | Semanal | `max(weekStart, campaignStart)` | `valor_referencia` da semana >= `weekly_goal_value` |
| CONVERSAO | 5 | Diária | `dateStr` | Taxa de pagamento do dia >= **80%** (`CONVERSION_MIN_RATE`, default `0.80`) |
| INDICACAO | 10/lote | Campanha acumulada | `campaignStart` | A cada **5 contratos pagos** em que o campo **`origem` contém "Indicação"** |
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

### Dias e propostas (`businessDays.js`)

- `isBusinessDay(dateStr)` — seg–sex (UTC, meio-dia)
- `filterByWeekdayCadastro(proposals)` — exclui cadastro em fim de semana
- `isWeekdayPaid(proposal)` — cadastro e pagamento em dia útil
- Loop diário: **pula sábado/domingo**; remove eventos de fim de semana no force
- `members/stats`: retorna `is_business_day: false` e zeros em fins de semana

### Cron vs force

- **Cron** (`triggeredBy = null`): dias passados processados em `daily_calculations` são pulados, **exceto** dias em `doubleDays` (jogo do Brasil)
- **Force** (`triggeredBy = userId`): apaga `score_events` + `daily_calculations` do período e recalcula tudo
- Disparado por: botão admin, mudança de equipe (`admin.js`), alteração em `brazil_matches` (`worldcup.js`)

### Fluxo geral

- Roda a cada 15 minutos via cron (`scheduler.js`)
- Carrega `getRulePointsMap()` no início
- Uma chamada cacheada de propostas: `campaignStart` → hoje, filtradas por dia útil
- Itera cada dia da campanha; aplica regras diárias em dias úteis
- `mult = doubleDays.has(dateStr) ? 2 : 1` para regras diárias
- `recalcDay = isToday || isForce || doubleDays.has(dateStr)` — limpa eventos obsoletos e regras competitivas
- TORCIDA: hoje via ranking ao vivo; retroativo em dias de jogo no **force** (ranking histórico por data)
- Após loop: META_SEMANA (recalcula semanas com jogo do Brasil), INDICACAO + CONTRATO_10K acumulados
- Datas PostgreSQL: `pgDateStr()` evita shift de fuso em `match_date` e `event_date`
- UI admin: **"🔄 Recalcular toda a campanha"** → `POST /api/scores/calculate` (master only, timeout 180s)

### Fluxo por dia útil
1. Filtra propostas com `getCadastroDateStr(p) === dateStr` (já só dias úteis)
2. Pagos: `isWeekdayPaid` (cadastro + pagamento em dia útil)
3. META_DIA, CONVERSAO, GOL_DE_PLACA, ARTILHEIRO × `mult`
4. TORCIDA_ORGANIZADA: hoje ou retroativo (force + dia de jogo)
5. Após loop: META_SEMANA; INDICACAO + CONTRATO_10K (sem ×2)

---

## Endpoint `/api/groups/:id/members/points`

**Fonte de verdade: `score_events` no banco** (leitura direta, sem chamar NewCorban).

- Retorna eventos agrupados por `event_date` em ordem decrescente
- Por dia: `date`, `events[]`, `daily_total`, `is_double_day`, `brazil_match` (`opponent`, `stage`)
- Por evento: `rule_name`, `points`, `base_points`, `multiplier`, `is_double`, `icon`, `label`, `description`
- Também: `adjustments`, `total_points`, `adj_total`, `grand_total`
- **O total bate com o leaderboard** — ambos leem de `score_events`
- Dia de hoje: tag "ao vivo" no `MembersModal.jsx`
- Dias de jogo: badge `🇧🇷 ×2` + texto `N pts base ×2 🇧🇷` quando `is_double`

## Endpoint `/api/groups/:id/members/stats`

- Propostas do dia por membro (NewCorban + ranking)
- Respeita dias úteis: `is_business_day: false` em sábado/domingo
- Query: `?date=YYYY-MM-DD`

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
| Configuração | `admin` | `ShellConfig.jsx` | Painel master completo |
| Minhas Equipes | `team_admin` | `ShellConfig.jsx` | Equipes do escopo apenas |

### Login (`pages/Login.jsx`)

- Fluxo em 3 passos: username NewCorban → (setup-password **ou** senha) → redirect `/`
- Removido toggle Cadastrar / auto-registro
- `setup-password` grava token e recarrega a página

### Configuração admin (`ShellConfig.jsx`)

**Master (`admin`) — ordem das seções:**
1. **Sub-admins de Equipe** — `SubAdminsConfig`
2. **Equipes e Jogadores** — `ShellAdminTeams.jsx` (criar equipe habilitado)
3. **Pontos por Regra** — `ScoringRulesConfig`
4. **Recálculo de Pontuação** — `RecalculateCampaign` → `POST /api/scores/calculate`
5. **Período da Campanha**
6. **Metas de Valor Referência por Equipe (R$)** + Meta de Pontos
7. **Ajuste Manual de Pontos** — `PointAdjustments`

**Sub-admin (`team_admin`):** seções 2, 6 e 7 apenas (equipes filtradas por `managed_group_ids` / `GET /api/admin/groups`).

### Outros

- `main.jsx`: **sem** `React.StrictMode` (causava double-mount e double requests em dev)
- `useEffect` depende de `group?.id` (não do objeto `group`) para evitar re-renders por referência
- `MembersModal.jsx`: abas Propostas (stats) e Pontos do Grupo; breakdown com ×2 Brasil; aviso em fim de semana

---

## Deploy — Modo Split (Frontend Hostinger Estático + Backend no Servidor)

> **Modo recomendado** — mais estável que Website Builder Node.js.

### Visão geral

| Camada | Onde | Como |
|--------|------|------|
| Frontend | Hostinger Static Hosting | Upload do `frontend/dist/` (HTML/CSS/JS estático) |
| Backend | Seu servidor (VPS/Docker) | `docker compose up -d backend` na porta 3001 |
| Banco | Seu servidor (mesmo VPS) | `docker compose up -d postgres` (já existente) |

### Passos para configurar

**1. No servidor (VPS) — arquivo `.env` na raiz:**
```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://copa_user:senha@postgres:5432/copa_gd
JWT_SECRET=...
NEWCORBAN_USERNAME=...
NEWCORBAN_PASSWORD=...
NEWCORBAN_API_USERNAME=...
NEWCORBAN_API_PASSWORD=...
CORS_ORIGIN=https://seu-dominio.hostinger.com
PUBLIC_BACKEND_URL=http://IP_DO_SERVIDOR:3001
```

**2. Subir backend no VPS:**
```bash
docker compose build backend
docker compose up -d backend postgres
```

**3. Liberar porta no firewall do VPS:**
```bash
ufw allow 3001/tcp
```
Ou configurar nginx como proxy reverso na porta 80/443 (recomendado para HTTPS).

**4. Build do frontend com a URL do backend:**
```bash
# Na sua máquina local, na pasta do projeto:
VITE_API_URL=http://IP_DO_SERVIDOR:3001 npm run build:frontend
# Ou se estiver no Windows:
set VITE_API_URL=http://IP_DO_SERVIDOR:3001 && npm run build:frontend
```
O arquivo `frontend/dist/` gerado contém a URL do backend embutida.

**5. Hostinger — criar site estático:**
- No painel Hostinger: **Websites → Add Website → Static Site** (não Node.js)
- Fazer upload do conteúdo de `frontend/dist/` via File Manager
- Configurar domínio

### Variáveis novas para o modo split

| Variável | Onde | Valor |
|----------|------|-------|
| `CORS_ORIGIN` | Backend `.env` | URL do seu domínio Hostinger (ex: `https://copa.grupodigital.com.br`) |
| `PUBLIC_BACKEND_URL` | Backend `.env` | URL pública do backend (ex: `http://191.252.159.244:3001`) |
| `VITE_API_URL` | **Build time** frontend | Mesma URL do `PUBLIC_BACKEND_URL` |

**Como funciona:**
- `CORS_ORIGIN` → backend aceita requests do domínio do frontend
- `PUBLIC_BACKEND_URL` → middleware em `server.js` reescreve `photo_url` relativas (ex: `/api/groups/1/photo`) para absolutas (ex: `http://servidor:3001/api/groups/1/photo`) — sem isso as fotos de equipe não carregam cross-origin
- `VITE_API_URL` → baked no build do React; `api/client.js` usa `VITE_API_URL + '/api'` como base; SSE usa `VITE_API_URL + '/api/events/stream'`

### Nginx como proxy reverso (recomendado para HTTPS)

Se quiser HTTPS no backend, instale nginx + certbot no VPS:
```nginx
# Gzip no nível nginx — aplica a assets estáticos e respostas que o Express não comprimiu
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1000;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

server {
    listen 80;
    server_name api.seu-dominio.com.br;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        # SSE — sem buffer
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```
Nesse caso `PUBLIC_BACKEND_URL=https://api.seu-dominio.com.br` e `VITE_API_URL=https://api.seu-dominio.com.br`.

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
   - `install:frontend` usa `--include=dev` (Vite/Tailwind são devDependencies; sem isso o build falha com `vite: command not found` quando `NODE_ENV=production` no host)
2. `npx vite build` em `frontend/` — gera `frontend/dist`
3. `npm start` → `node backend/src/server.js`
4. Com `NODE_ENV=production` ou `SERVE_STATIC=true`, Express serve `frontend/dist` na mesma porta

**Hostinger:** **Output directory** do painel deve ficar **vazio** (não `frontend/dist`); o Express serve o `dist` internamente.

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
| `FOOTBALL_API_KEY` | Recomendado | football-data.org — sync automático na startup + `POST /api/worldcup/sync` |
| `CONVERSION_MIN_RATE` | Não | Default `0.80` (80% de conversão no dia) |

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
| `users_role_check` ao criar sub-admin | Rodar SQL de `team_admin` como owner do banco |
| `vite: command not found` no build Hostinger | `install:frontend` com `--include=dev` no `package.json` raiz |
| `503` / app não sobe | Erro de sintaxe em `scoring.js`, `DATABASE_URL` inválida, ou Output directory errado no painel |
| `ENOTFOUND host` | `DATABASE_URL` ainda com placeholder do `.env.example` |

### Banco na primeira subida

1. Criar database PostgreSQL vazio no provedor (Hostinger, Neon, servidor próprio…)
2. Executar **`backend/src/db/schema.sql` uma vez** (pgAdmin, DBeaver, SQL do painel)
3. Configurar `DATABASE_URL` no painel e redeploy
4. Na subida, **`seed.js`** automaticamente:
   - Cria admin `admin` / `admin2026`
   - Migrations: colunas em `groups`/`users`, `scoring_rules`, `campaign_settings`, `team_admin`
   - `migrateTeamAdminSupport()` — pode falhar se `copa_app` não for owner; usar SQL manual
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
| Jun/26 | Pontos não atualizavam ao mover vendedor de equipe | `triggerRecalculate` em todos os endpoints de membership; force apaga e recalcula campanha inteira |
| Jun/26 | INDICACAO não pontuava com origem "Indicação" | `utils/proposals.js`: `origem` deve **conter** "Indicação" |
| Jun/26 | CONVERSAO exigia 25% de pagos | Meta alterada para **80%**; botão de recálculo total em `ShellConfig` |
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
| Jun/26 | `scoring.js` syntax error (`toDateStr` quebrado) | Causava 503 em produção; restaurar `function toDateStr` |
| Jun/26 | Build Hostinger `vite: command not found` | `install:frontend --include=dev`; `npx vite build` |
| Jun/26 | Sub-admins `users_role_check` | Migration `migrations.js`; SQL manual como postgres |
| Jun/26 | INDICACAO/CONTRATO_10K dobravam no dia de hoje | Removido ×2 de regras acumuladas de campanha |
| Jun/26 | Fim de semana contava na campanha | `businessDays.js`; seg–sex apenas |
| Jun/26 | ×2 Brasil não retroativo | Reprocessar dias em `doubleDays`; recalc ao alterar `brazil_matches` |
| Jun/26 | Breakdown ×2 pouco visível | `MembersModal`: badge 🇧🇷, `base_points`, adversário |
| Jun/26 | Sub-admins sem UI de gestão | `SubAdminsConfig` + role `team_admin` + `admin_team_scopes` |
| Jun/26 | META_DIA sem bônus por superação | `META_DIA_PLUS30/50/100` (+10/+15/+20 pts); tier mais alto vence; ×2 em dia de jogo |
| Jun/26 | `scoring.js` GROUP BY sem colunas CLT/FGTS | Adicionado `g.daily_goal_clt, g.daily_goal_fgts, g.weekly_goal_clt, g.weekly_goal_fgts` ao GROUP BY; sem isso o cron falhava com erro PostgreSQL a cada rodada |
| Jun/26 | Cron sem guarda contra rodadas simultâneas | `scheduler.js`: flag `isRunning` + `finally` — se rodada anterior ainda está em andamento, a nova é pulada (evita esgotamento do pool DB) |
| Jun/26 | App crashava sob carga (unhandledRejection) | `server.js`: handlers `process.on('unhandledRejection')` e `process.on('uncaughtException')` — erros async inesperados não derrubam mais o processo |
| Jun/26 | Pool PostgreSQL sem keepalive (conexões mortas) | `db.js`: `keepAlive: true`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`, `max: 10` — evita 403 quando firewall mata conexões idle |
| Jun/26 | N queries DB simultâneas quando vários usuários recebem SSE ao mesmo tempo | Cache de resposta 30s em `middleware/responseCache.js` aplicado em `/leaderboard`, `/today-activity` e `/individual-rankings`; cache invalidado via `invalidateResponseCache()` no `broadcast('scores_updated')` |
| Jun/26 | Sem compressão gzip nas respostas HTTP | Pacote `compression` adicionado ao Express (`server.js`); SSE excluído do filtro; nginx: `gzip on` + `X-Forwarded-For` headers |
| Jun/26 | IP real do cliente invisível atrás do nginx | `app.set('trust proxy', 1)` em `server.js`; rate limiter usa `req.ip` corretamente |
| Jun/26 | Sem proteção a brute-force no login | `middleware/rateLimiter.js`: 20 tentativas por IP em 15 min; aplicado em `POST /api/auth/login` |
| Jun/26 | Pool sem conexões mínimas (cold-start lento) | `db.js`: `min: 2` — mantém 2 conexões aquecidas no pool |
| Jun/26 | Cache `_cache` em `externalApi.js` sem limpeza automática | Entradas expiradas acumulavam na memória (nova chave a cada dia). Corrigido: `setInterval` de 10 min que remove entradas com `expiresAt` vencido |
| Jun/26 | SSE `clients` Set crescia ilimitado sob nginx da Hostinger | `req.on('close')` não dispara quando nginx fica no meio. Corrigido: limite `MAX_SSE_CLIENTS=50` + remoção proativa no catch do keepalive ping |
| Jun/23 | `DELETE /api/admin/adjustments/:id` sem `authMiddleware` | Qualquer usuário podia deletar ajustes de pontos sem autenticação. Adicionado `authMiddleware, configAdminOnly` |
| Jun/23 | Contagem de membros incluía usuários inativos no limite | `COUNT(user_id)` sem `JOIN users WHERE active=true` fazia membro desativado ocupar vaga — bloqueava adição do 6º jogador. Corrigido nas 3 queries de verificação de capacidade |
| Jun/23 | `torcidaMap` undefined em TORCIDA_ORGANIZADA retroativa | Se fetch do ranking histórico falhava, `vendorMapByDate[dateStr]` era `undefined` e `.every()` lançava TypeError. Corrigido: `|| {}` no fallback |
| Jun/23 | `parseFloat(null)` retornava `NaN` em `scoringRules.js` | Se `base_points` fosse NULL no banco, pontuação ficava `NaN`. Corrigido: fallback para `FALLBACK[rule] || 0` quando `isNaN(pts)` |
