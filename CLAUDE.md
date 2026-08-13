# Ranking GD — Guia para o Claude

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

| Mudou | Comando |
|-------|---------|
| Código do backend | `docker compose restart backend` — `./backend/src` é volume, não precisa rebuild |
| Variável no `.env` | `docker compose up -d backend` — **`restart` não serve**: o container carrega o ambiente de quando foi criado |
| Dependência (`package.json`) | `docker compose build backend` → `docker compose up -d backend` |

**Frontend em `localhost:3010`** (o compose mapeia `3010 → 3000`). A porta 3000 do host pode estar ocupada por outro projeto.

**`DATABASE_URL` fica comentada no `.env`** — sem ela, o compose usa o Postgres do container. Apontar o dev para o banco de produção já causou congelamento acidental de campanha real. Para ter dados reais localmente, copie o banco: ver [`DEPLOY.md`](DEPLOY.md).

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

### Donos de franquia (`franqueado`)

> Fase 1 de "campanhas por franquia" (12/08/2026). O dono cria e administra as
> campanhas da própria unidade; campanha para todas continua sendo só da matriz.

| Pode | Não pode |
|------|----------|
| Criar campanha da própria franquia | Escolher a abrangência (vem do escopo dele) |
| Editar/ativar/encerrar as próprias campanhas | Editar campanha criada pela matriz (vê, não mexe) |
| Ver o placar e o telão das que participa | Ver campanha de outra franquia (403, mesmo sabendo o id) |
| Ver os rankings do app | Congelar placar · painel de Configuração · equipes da Copa |

- Tabela `admin_franquia_scopes(user_id, franquia_id)` — PK composta. `franquia_id` é **VARCHAR**, não FK: o identificador vem do NewCorban como texto e inclui o token `'matriz'`. Não existe tabela local de franquias
- Migration: `migrateFranquiaOwners()` em `backend/src/db/migrations.js`
- `users.role` agora aceita `franqueado`. A CHECK é gerada de `ROLES_PERMITIDOS` por `garantirRolesPermitidos()` — **fonte única**; antes cada migration escrevia a lista à mão e foi isso que exigiu SQL manual em produção quando o `team_admin` entrou
- Login: username + senha definidos pela matriz (não usa NewCorban). Derivar a franquia do cadastro do NewCorban faria consultor com `franquia_id` nulo virar dono da matriz por acidente
- `GET /api/auth/me` retorna `managed_franquia_ids: string[]` para `franqueado`
- Endpoints (master): `GET/POST/PUT /api/admin/franqueados`
- UI master: `ShellConfig` → **🏬 Donos de Franquia** (`components/FranqueadosConfig.jsx`)
- UI do dono: entra direto em **Campanhas**; sem item Configuração. (Desde 13/08/2026 **todo mundo** entra por Campanhas — o "Ranking Equipe" saiu do menu, então esta já não é uma exceção do franqueado)

#### Política de acesso — `services/campaignAccess.js`

Funções puras, sem Express e sem banco. **Filtro em JS, não em SQL**, de propósito: campanhas são dezenas (a rota sempre leu todas), e uma cláusula SQL paralela seria uma segunda verdade capaz de divergir em silêncio justo na regra que, se errar, mostra campanha de uma franquia para outra.

| Função | Regra |
|--------|-------|
| `podeVer` | master: tudo · franqueado: as próprias (por `owner_franquia_id`) + as da matriz que alcançam a franquia dele, inclusive rascunho · demais: só não-rascunho que os alcança |
| `abrangenciaParaCriacao` | master: o que pediu (vazio = empresa inteira) · franqueado: **o escopo dele, ignorando o corpo** |
| `donoDaCampanha` | `campaigns.owner_franquia_id` — NULL = matriz. Com escopo múltiplo, a primeira franquia |
| `podeEditar` | master: tudo · franqueado: só onde `owner_franquia_id` está no escopo dele |
| `camposEditaveis` | `franquia_ids` sai da lista do franqueado — senão o PUT desfaria o travamento da criação |

**Armadilha travada por teste:** `franquia_ids = []` é lido como *sem filtro* lá no placar (`getSellerIdsPorFranquia` devolve `null`). Um dono sem vínculo criaria campanha da empresa inteira — por isso escopo vazio é **recusado com 400**, não normalizado.

**A checagem do `/board` é middleware (`carregarCampanha`), não código dentro do handler:** o `responseCache` responde antes do handler, então a verificação lá dentro seria pulada toda vez que a resposta viesse do cache. Coberto por teste (`o cache do placar não fura a permissão`).

**Franquia do consultor** vem do cadastro do NewCorban (`getFranquiasDoConsultor`), não do banco local. Cadastro fora do ar → lista vazia → ele enxerga só campanha da empresa inteira. Esconder demais é melhor que vazar campanha alheia.

#### `GET /api/franquias`

Catálogo derivado de `getMapaFranquias()` (cache de 15 min), já recortado pelo escopo de quem pediu: `{ franquias: [{ id, nome, consultores }], todas_as_franquias }`. `consultores` não conta robôs — é o número que avisa que uma franquia sem gente daria placar vazio.

**Sem `responseCache` de propósito:** a chave dele é a URL e esta resposta muda por usuário; dois papéis na mesma URL serviriam a lista um do outro.

Medido em 12/08/2026: **16 franquias** distintas no cadastro — Matriz (644 consultores), Guarulhos Centro (210), Gabriel Machado (108), Boa Vista (15), entre outras. A lista de 4 franquias que aparece mais abaixo neste documento é de agosto/2026 e **já estava desatualizada** — motivo a mais para o catálogo ser derivado e não cadastrado à mão.

#### O que a Fase 1 **não** faz

| Limite | Consequência hoje |
|--------|-------------------|
| Placar continua sendo **de um dia** (`diaDoPlacar` = `start_date`) | Campanha de vários dias mostra só o primeiro. O formulário exibe aviso laranja quando `fim ≠ início` |
| `metric` segue gravado e nunca lido | Por isso **não** aparece no formulário — campo que não muda nada é formulário mentindo |
| `color` não tem regra de estilo consumindo | Fora do formulário pelo mesmo motivo |
| Metas (coletiva/franquia/individual) e premiação por colocação | Fases 3 e 4 |

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
| META_DIA | 5 | Meta 1 — threshold = `groups.daily_goal_value` |
| META_DIA_PLUS30 | 10 | Meta 2 — threshold fixo = `groups.daily_goal_meta2` (mutualmente exclusivo — tier mais alto vence) |
| META_DIA_PLUS50 | 15 | Meta 3 — threshold fixo = `groups.daily_goal_meta3` |
| META_SEMANA | 10 | × multiplier se semana tem dia de jogo |
| CONVERSAO | 5 | |
| INDICACAO | 10 | **por lote** de 5 contratos pagos com `origem` contendo "Indicação" |
| CONTRATO_10K | 5 | **por contrato** > R$ 10.000 |
| GOL_DE_PLACA | 15 | competitiva diária |
| TORCIDA_ORGANIZADA | 20 | |
| ARTILHEIRO | 15 | competitiva diária |

**Removidos:** META_DIA_PLUS100 (20 pts), META_DIA_CLT, META_DIA_FGTS, META_SEMANA_CLT, META_SEMANA_FGTS — descontinuados. O seed deleta essas entradas do banco automaticamente.

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
| GET | `/api/scores/individual-rankings` | JWT | **Legado** — só serve o arquivamento da Copa (`POST /api/campaigns/archive-legacy`). O ranking individual vivo é `/api/rankings/mensal`. Top 3: `melhor_vendedor` (por `total_valor`) e `rei_assistencias` (por `indicacao_count`) |

### Migrations (`seed.js` + `migrations.js`)

- `CREATE TABLE IF NOT EXISTS scoring_rules` + insert dos defaults com `ON CONFLICT`
- `ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_password_setup`
- `ALTER TABLE groups ADD COLUMN IF NOT EXISTS daily_goal_value, weekly_goal_value, goal_points, photo_data, photo_mime`
- `migrateTeamAdminSupport()` em `backend/src/db/migrations.js` — role `team_admin` + tabela `admin_team_scopes`
- `CREATE TABLE IF NOT EXISTS campaign_settings` + campanha padrão se vazia
- `migrateMonthlyRankings()` em `migrations.js` — `monthly_rankings` + `monthly_ranking_meta` (ranking individual mensal congelado)

---

## Atualizações em Tempo Real (SSE)

- Endpoint: `GET /api/events/stream` — sem autenticação (só notifica, dados vêm de endpoints autenticados)
- Backend: `backend/src/routes/events.js` — mantém Set de clientes conectados + função `broadcast(event, data)`
- O `broadcast('scores_updated', {ts})` é chamado:
  - Após cada rodada do cron (`scheduler.js`)
  - Após cálculo manual pelo admin (`scores.js`)
  - Após alteração de jogos do Brasil (`worldcup.js` → recálculo force)
- Frontend: `EventSource('/api/events/stream')` em `CampaignBoard.jsx` — reconecta automaticamente em caso de queda. O outro assinante era a página "Ranking Equipe" (`ShellRanking.jsx`), removida em 13/08/2026; **as páginas de ranking do mês/digitados nunca usaram SSE** — elas recarregam por intervalo próprio, porque a fonte é a NewCorban e não `score_events`
- Fallback: `setInterval` de 5 minutos caso SSE não funcione
- Vite proxy: `timeout: 0` no `/api` para suportar conexões longas

### Cache de resposta e invalidação

- `middleware/responseCache.js` — chave = **`req.originalUrl`** (inclui query string; antes era `req.path`, e `?date=X` colidia com `?date=Y`)
- TTL padrão vem do argumento (`responseCache(30_000)`); a rota pode sobrescrever gravando `res.locals.cacheTtlMs` antes do `res.json`
- `invalidateResponseCache(prefixes?)` — sem argumento limpa tudo; com prefixos limpa só as chaves que começam com eles
- `broadcast('scores_updated')` invalida **apenas `/api/scores`** (`SCORE_CACHE_PREFIXES` em `events.js`). O placar de campanha ficou de fora de propósito: ele lê a NewCorban e a tabela `campaigns`, não `score_events`
  - Antes o cron (a cada 5 min) zerava o mapa inteiro e derrubava junto o cache do placar — todo telão voltava ao caminho frio no mesmo instante em que o SSE mandava todos recarregarem
- Não cacheia resultado vazio nem resposta fora da faixa 2xx

---

## APIs Externas (NewCorban)

### Propostas (API v3 — sem limite de 30 dias)
```
GET https://developers.newcorban.com.br/v1/proposals
Authorization: Bearer <NEWCORBAN_PROPOSALS_TOKEN>
Params:
  date_type=payment|created  start_date=YYYY-MM-DD  end_date=YYYY-MM-DD
  seller[]=<corban_id>  (repetido por vendor)  stage[]=paid  per_page=100  page=N
```
Retorno: `{ success, data: [...], meta: { current_page, last_page } }`. Paginação automática em `getProposalsV3()`.  
Campo chave: `assignment.seller.id` = corban_id, `proposal.reference_amount` = valor, `dates.payment_date` e `dates.created_at`.

> **API legada** (`POST api.newcorban.com.br/api/propostas/`) ainda existe em `getProposals()` mas não é mais usada pelo scoring. Limite de 30 dias a partir de hoje.

### Chave da API v3
- Env var: `NEWCORBAN_PROPOSALS_TOKEN`
- Formato: `nc_live_...` (Bearer)
- Obter/rotacionar em: **Empresa → API** no painel NewCorban

### Ranking (para qtd_propostas do dia — TORCIDA_ORGANIZADA)
```
GET https://server.newcorban.com.br/system/ranking.php?action=performance&i=BASE64
Authorization: Bearer <token v2>
```
Token v2: `POST https://apiv2.newcorban.com.br/api/v2/auth/login`

### Retry de token — nunca recursar por cima do dedup

O `ranking.php` responde **200 com erro de token no corpo** (`Token mismatch`), e
com frequência: o log de produção de 13/08/2026 tinha **80 re-obtenções de
token**. Por isso `getRankingPeriodo` e `getRankingByPayment` retentam.

O retry mora em `fetchRankingPeriodo` / `fetchRankingByPayment` — funções
internas que **nunca consultam o `_inflight`**. Enquanto ele recursava na função
pública, a recursão caía no próprio dedup e recebia de volta a promise que
estava esperando por ela: a promise passava a depender de si mesma. Com o
`.catch` encadeado o ciclo tem **comprimento 2**, e o V8 só detecta ciclo de
comprimento 1 (`Chaining cycle detected`) — então nada lançava, o `.finally`
nunca rodava e a chave ficava **presa no `_inflight` para sempre**.

> **Regra:** função que faz dedup por `_inflight` não pode se chamar de novo por
> dentro do próprio `.then`/`.catch`. Extraia a execução; recursa na interna.

`getRanking` também retenta, mas **não** usa `_inflight` — por isso está a
salvo. `getProposals` e `getProposalsV3` usam `_inflight` e **não** retentam
token. Coberto por `externalApiRetry.test.js`.

### Cache
- TTL: 3 minutos em memória (`_cache` Map em `externalApi.js`)
- Inflight dedup: se a mesma key já está em andamento, aguarda a Promise existente
- Chave: `proposals:startDate:endDate:corbanIds_sorted`
- **Janela da API v3:** sem limite de data — pode buscar desde `campaignStart`. `getProposalsV3()` usa `campaignStart → today` diretamente.
- **API legada:** a antiga `POST /api/propostas/` tinha limite de 30 dias e está em `getProposals()` (não usada pelo scoring).

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
- `daily_goal_value`: Meta 1 do dia — 5 pts quando atingida
- `daily_goal_meta2`: Meta 2 do dia — 10 pts quando atingida (threshold fixo, independente da Meta 1)
- `daily_goal_meta3`: Meta 3 do dia — 15 pts quando atingida (threshold fixo, independente da Meta 1)
- `weekly_goal_value`: meta semanal em R$ (META_SEMANA, 10 pts)
- `daily_goal_clt`, `daily_goal_fgts`, `weekly_goal_clt`, `weekly_goal_fgts`: colunas legadas CLT/FGTS — mantidas no banco mas não usadas mais

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

### `admin_franquia_scopes`
- `(user_id, franquia_id)` — franquias que cada `franqueado` administra
- `franquia_id` é VARCHAR e **não é FK**: o id vem do NewCorban e inclui o token `'matriz'`
- Criada por `migrateFranquiaOwners()`

### `campaigns.owner_franquia_id`
- Franquia dona da campanha. **NULL = criada pela matriz** (abrangência livre)
- É o que separa "minha campanha" de "campanha que a matriz mandou": as duas aparecem para o franqueado, só a primeira ele edita

### `users.role`
- Valores: `player`, `admin`, `team_admin`, `franqueado`
- Constraint gerada de `ROLES_PERMITIDOS` (`migrations.js`) por `garantirRolesPermitidos()` — não escrever a lista à mão em migration nova
- `users_role_check CHECK (role IN ('player', 'admin', 'team_admin', 'franqueado'))`

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

**Conferência de variáveis na subida:** `backend/src/config/validateEnv.js`, chamado pelo `server.js` antes do seed. Loga `[Env] ❌` para obrigatórias (`DATABASE_URL`, `JWT_SECRET`, `NEWCORBAN_USERNAME`, `NEWCORBAN_PASSWORD`) e `[Env] ⚠️` para as que degradam sem derrubar, dizendo **o que se perde** em cada caso. Existe porque o `.env` é gitignored e sem backup: uma reescrita do arquivo derruba um segredo em silêncio e o sintoma só aparece na tela horas depois.

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

**Proposta válida (CONVERSAO/ARTILHEIRO/GOL_DE_PLACA/CONTRATO_10K):** cadastro em dia útil; pagamento também em dia útil.  
**META_DIA / META_SEMANA:** usa **data de pagamento** (`datas.pagamento`) como referência — proposta cadastrada em 22/06 mas paga em 29/06 conta no valor do dia 29/06.

**Não há lista fixa de jogos no código** — só o que estiver em `brazil_matches` no banco.

> Pontos base vêm de `scoring_rules.base_points` (editável pelo admin master).  
> **Pontos em dobro (×2)** em dias com jogo do Brasil (`brazil_matches.double_points = true`):
> - Regras **diárias** (em dia útil): META_DIA, CONVERSAO, CONTRATO_10K, GOL_DE_PLACA, ARTILHEIRO, TORCIDA_ORGANIZADA
> - **META_SEMANA**: ×2 se **qualquer dia útil** da semana tiver jogo do Brasil
> - **INDICACAO** (campanha acumulada): **não** dobra
> - Campo `score_events.is_double_points` + breakdown em `/api/groups/:id/members/points`
> - Breakdown UI: badge `🇧🇷 ×2` no dia, `base_points`, `multiplier`, `brazil_match` (adversário)
> - **Retroativo:** dias em `brazil_matches` são recalculados mesmo após `daily_calculations`; alterar jogos ou "Recalcular campanha" aplica ×2 no passado; TORCIDA retroativa busca ranking histórico no force recalc

| Regra | Pontos (padrão) | Tipo | event_date | Critério |
|-------|-----------------|------|------------|----------|
| META_DIA | 5 | Diária | `dateStr` (hoje) | Soma do `valor_referencia` das propostas com **pagamento = dateStr** >= `groups.daily_goal_value` (Meta 1) |
| META_DIA_PLUS30 | 10 | Diária (bônus) | `dateStr` | Meta 2: mesmo valor acumulado >= `groups.daily_goal_meta2`; tier mais alto vence |
| META_DIA_PLUS50 | 15 | Diária (bônus) | `dateStr` | Meta 3: mesmo valor acumulado >= `groups.daily_goal_meta3` |
| META_SEMANA | 10 | Semanal | `max(weekStart, campaignStart)` | Soma do `valor_referencia` das propostas com **pagamento dentro da semana** >= `weekly_goal_value` |
| CONVERSAO | 5 | Diária | `dateStr` | **Mínimo 10 propostas** no dia + taxa de pagamento >= **80%** (`CONVERSION_MIN_RATE`, default `0.80`); propostas CANCELADA excluídas |
| INDICACAO | 10/lote | Campanha acumulada | `campaignStart` | A cada **5 contratos pagos** em que o campo **`origem` contém "Indicação"** |
| CONTRATO_10K | 5/contrato | **Diária** | `dateStr` | Por contrato **pago hoje** com `valor_referencia > 10000` (conta ×2 em dia de jogo) |
| GOL_DE_PLACA | 15 | **Diária competitiva** | `dateStr` | Grupo com o maior contrato **pago** hoje entre todos os grupos |
| ARTILHEIRO | 15 | **Diária competitiva** | `dateStr` | Grupo com mais contratos com **pagamento = dateStr** entre todos os grupos (data de pagamento, não cadastro) |
| TORCIDA_ORGANIZADA | 20 | Diária | `dateStr` | Todos os membros do grupo com **≥10 contratos com pagamento = dateStr**; sem mínimo de membros |

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

### Campanha encerrada: o cron não recalcula

Se `campaign_settings.end_date` já passou, `calculateScores` **retorna sem fazer nada** no modo cron (a limpeza de eventos pós-fim continua rodando antes disso). O botão "Recalcular toda a campanha" (`isForce`) continua reprocessando normalmente.

Sem essa guarda, o cron baixava a campanha inteira da API v3 a cada 5 minutos — **duas chamadas paginadas de mais de cem páginas cada** — que respondiam `429` e esperavam 10/20/30s por página. O NewCorban é o mesmo para o app todo: enquanto isso rodava, o **Ranking do Mês ficava na fila e estourava o timeout de 30s do navegador**. Medido em 12/08/2026: `GET /api/rankings/mensal?mes=2026-08` levou **304s e falhou**, contra 11–25ms dos meses congelados; depois da guarda, **2s**.

> **O que se perde:** pagamento confirmado pelo banco depois do fim da campanha não entra mais sozinho. É para isso que existe o botão de recálculo manual. A alternativa (reconciliação uma vez por dia em vez de a cada 5 min) não foi implementada — se a Copa voltar a receber lançamento tardio, é o caminho.

### Cron vs force

- **Cron** (`triggeredBy = null`): dias passados processados em `daily_calculations` são pulados, **exceto** dias em `doubleDays` (jogo do Brasil)
- **Campanha encerrada** (`end_date < hoje`): o cron nem chega a buscar propostas — ver acima
- **Force** (`triggeredBy = userId`): apaga `score_events` + `daily_calculations` do período e recalcula tudo
- Disparado por: botão admin, mudança de equipe (`admin.js`), alteração em `brazil_matches` (`worldcup.js`)

### Fluxo geral

- Roda a cada **5 minutos** via cron (`scheduler.js` — `*/5 * * * *`)
- Carrega `getRulePointsMap()` no início
- Uma chamada cacheada de propostas: `campaignStart` → hoje, filtradas por dia útil
- Itera cada dia da campanha; aplica regras diárias em dias úteis
- `mult = doubleDays.has(dateStr) ? 2 : 1` para regras diárias
- `recalcDay = isToday || isForce || doubleDays.has(dateStr)` — limpa eventos obsoletos e regras competitivas
- TORCIDA: hoje via ranking ao vivo; retroativo em dias de jogo no **force** (ranking histórico por data)
- Após loop: META_SEMANA (recalcula semanas com jogo do Brasil), INDICACAO acumulado
- Datas PostgreSQL: `pgDateStr()` evita shift de fuso em `match_date` e `event_date`
- UI admin: **"🔄 Recalcular toda a campanha"** → `POST /api/scores/calculate` (master only, timeout 180s)

### Fluxo por dia útil
1. Filtra propostas com `getCadastroDateStr(p) === dateStr` (já só dias úteis)
2. Pagos: `isWeekdayPaid` (cadastro + pagamento em dia útil)
3. META_DIA, CONVERSAO, CONTRATO_10K, GOL_DE_PLACA, ARTILHEIRO × `mult`
4. TORCIDA_ORGANIZADA: hoje ou retroativo (force + dia de jogo)
5. Após loop: META_SEMANA; INDICACAO (sem ×2)

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
| Campanhas | todos | `ShellCampaigns.jsx` | Lista de campanhas — **página de entrada de todo mundo** |
| Ranking do Mês | todos | `ShellRankingIndividual.jsx` | Pagos do mês por R$ + abas de mês + telão |
| Digitados do Dia | todos | `ShellRankingToday.jsx` | Digitados do dia por quantidade + telão |
| Meu Grupo | `player` | `ShellMyGroup.jsx` | Visualização da equipe (somente leitura) |
| Configuração | `admin` | `ShellConfig.jsx` | Painel master completo |
| Minhas Equipes | `team_admin` | `ShellConfig.jsx` | Equipes do escopo apenas |

**"Ranking Equipe" saiu do menu em 13/08/2026.** Era o placar da Copa GD 2026,
encerrada em 31/07, e o mesmo placar já está no **card arquivado dentro de
Campanhas** — duas portas para a mesma foto congelada, uma delas parecendo o
ranking vivo do escritório. Ver o histórico de bugs (Ago/13) para o que foi
junto e o que precisou ser preservado.

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

### Telão de campanha (`pages/CampaignBoard.jsx`)

**Duas superfícies** (ago/2026, a pedido do cliente): a coluna esquerda é um **palco escuro** (`.tv-left`, gradiente 168° sobre `#0B0D10`) com a identidade da campanha, o pódio **Destaques** e confete; a direita segue no claro, com a **Escada do Resgate deitada** acima do ranking. Antes a esquerda era só a escada, que abraça o próprio conteúdo (`flex: 0 1 auto`) e deixava metade da coluna vazia.

O cartão de destaque é o `.cc` de **`copa_gd_painel_.html`** (protótipo na raiz do repo, referência fixada pelo cliente): metal em gradiente, faixa no topo, marca d'água da colocação. Cliente escolheu explicitamente a variante **escura** e o **confete** — por isso a coluna inteira virou palco escuro, e não três cartões escuros soltos no verde-lilás, onde leriam como remendo.

> ⚠️ Isto contraria o [`DESIGN.md`](DESIGN.md), que proíbe pódio 1/2/3, gradiente, `box-shadow`, raio de canto e emoji como ícone. O `DESIGN.md` é um **seed nunca implementado** — o `system.css` real já o contrariava inteiro (fundo claro, raio 16, sombras). A autoridade visual aqui é o `system.css` + o protótipo do cliente. **A divergência entre os dois documentos continua aberta.**

### Pódio Destaques — `CardDestaque`

> **A referência é `buildTop3Card()` do arquivo `sales-arena.html`, enviado pelo cliente.** Não é o `.cc` do `copa_gd_painel_.html` (protótipo mais antigo, ainda na raiz do repo) — os dois são parecidos e foi justamente confundir um com o outro que produziu um cartão "estranho". Ao mexer no cartão, **conferir contra o `sales-arena`**.

**Três cartões iguais**, na ordem de leitura da referência:

```
[medalha] [avatar]  Nº LUGAR / nome / chip verde da equipe   ← .r1-top
RECUPERAÇÕES / 20                                             ← refBlock
PRÓXIMO GIRO │ REFERÊNCIA                      [giros]        ← secRow (com divisor)
▓▓▓▓▓▓▓▓▓▓▓░░░░                                               ← progBlock
```

Valores copiados do arquivo (os px viram `clamp()` com **teto** no valor dele: a 1080p sai igual, abaixo encolhe em vez de estourar a coluna):

| | 1º (ouro) | 2º (prata) | 3º (bronze) |
|---|---|---|---|
| Fundo | `#1C1100 → #2E1D00 → #1C1100` | `#080E1C → #0E1A2E → #080E1C` | `#160900 → #241200 → #160900` |
| Borda | `rgba(255,184,0,.5)` | `rgba(148,180,220,.4)` | `rgba(196,120,60,.45)` |
| Sombra | `0 8px 36px rgba(200,140,0,.35)` | `0 4px 22px rgba(100,150,200,.22)` | `0 4px 18px rgba(160,90,30,.25)` |
| Acento | `#FFB800` | `#94B4DC` (azul frio, de propósito) | `#C8784A` |
| Raio · flex | 16px · `flex-grow: 1.5` | 12px · 1 | 12px · 1 |

**Erros que eu já cometi neste cartão** (todos por não olhar o arquivo):

| Errado | Certo |
|---|---|
| Fundo marrom claro saturado | Quase preto — a cor vem dos **blobs radiais** `.tv-cc-glow`/`.tv-cc-glow2`, não do gradiente |
| Sombra preta | Brilho **dourado** por fora |
| Medalha montada sobre o avatar | **Irmãos separados por gap** |
| Selo de giros grande e chapado | Pílula **discreta**: 12px, `rgba(255,255,255,.07)`, texto no tom do metal |
| Faixa metálica no topo, marca d'água do número | **Não existem na referência** — eu inventei |
| Sem divisor entre os dados de apoio | `.tv-cc-sep`, 1px × 28px, `rgba(255,255,255,.1)` |
| Avatar sem brilho | Anel + `box-shadow` + pulso (`avatarPulse`) no 1º |
| Valor grande dourado | **Branco**, peso 900 |

Divergências deliberadas da referência: **medalha em SVG** (o arquivo usa 🥇 — emoji é desenhado pelo SO e a TV renderiza o que a fonte dela tiver) e **nome que quebra em vez de truncar** (o arquivo usa `text-overflow: ellipsis`; PRODUCT.md trata truncar nome como falha a corrigir, não a copiar).

> ⚠️ **Já foi tentada — e recusada — uma versão com líder grande e 2º/3º em uma linha.** O argumento era bom (o pódio repetia as 3 primeiras linhas do ranking que está na mesma tela) mas o cliente recusou explicitamente: *"ficou pior do que antes… não quero card grande"*. **Não reintroduzir sem pedido dele.**

| Decisão | Por quê |
|---|---|
| O cabeçalho "CAMPANHA DO DIA / \<nome\>" **saiu da coluna** | Repetia o nome que está na barra superior, e a frase da campanha repetia o "+1 giro a cada N" da escada. Eram ~145px de altura duplicada — exatamente o que faltava para os três cartões caberem no arranjo da foto |
| Número grande = **recuperações**, não R$ | Na foto o grande é R$ referência. Aqui `contracts` é o contador que abre giro e por onde o `board` ordena; o R$ fica no apoio |
| Valor grande em **branco**, rótulos em dourado | Como na referência: o metal é o fundo, não a tinta do número |
| Confete **dentro** do cartão (`ConfeteCartao`, 12 peças) | O confete do palco fica atrás e o cartão é opaco: sem esta camada, as peças que na foto aparecem por cima do metal não existiriam |
| Medalha em **SVG ao lado** do avatar | Emoji 🥇 é desenhado pelo SO (a TV renderiza o que a fonte dela tiver) e não comporta o numeral. Centrada na base — como no protótipo — a fita cobria as iniciais |
| Iniciais, nunca foto | O placar lê a NewCorban, que não devolve avatar de vendedor |
| `.tv-cc { flex: 1 0 auto }` + `.tv-podio-cards { overflow-y: auto }` | Com shrink livre, tela baixa comprimia o cartão abaixo do conteúdo e o `overflow:hidden` **cortava o nome pela metade** |

**Altura é o recurso escasso** — barra superior, régua de progresso e rodapé não encolhem, então a conta sobra toda para o pódio. Medido em Chrome headless (`.tv-podio-cards` box vs `scrollHeight`, mais overflow horizontal): cabe exato em **1920×1080, 1920×840, 1600×900, 1440×820 e 1366×768**. A folga é zero por construção — **mexer em padding ou corpo de fonte exige remedir**.

Abaixo de 1080p as `vh` encolhem tudo até o **piso dos `clamp()`**, e é o piso (não a escala) que estoura a coluna. Por isso a degradação é por corte, em duas etapas:

| Altura | Sai | Por quê |
|---|---|---|
| ≤ 860px | `.tv-cc-pos` ("Nº LUGAR") | Repete o número que já está dentro da medalha |
| ≤ 800px | `.tv-cc-team`; o **vão entre as linhas** encolhe | Ver abaixo: o que encolhe é o vão, nunca o recheio da borda |

**O recheio é maior que o do arquivo de propósito** — até 40px/34px contra 24px/18px. O `sales-arena` roda numa coluna mais larga; com a nossa, o mesmo número lê como conteúdo colado na borda (reclamação do cliente, ago/2026, duas vezes). A folga saiu da sobra que os cartões já tinham ao esticar por `flex-grow` — nada encolheu.

Duas armadilhas medidas nesse ajuste:

1. **O recheio lateral acompanha a LARGURA da janela** (`clamp(24px, 2.4vw, 40px)`). Numa janela de 1152px ele caía para 22px enquanto em 1920px ficava em 32px — por isso "está colado" e "não está colado" podiam ser verdade ao mesmo tempo. O piso do `clamp` é que resolve.
2. **Em tela baixa o vertical descolava do lateral** (17px contra 40px), e é a assimetria — não o valor — que faz a medalha parecer colada em cima. Em `≤800px` a altura que falta sai do `gap` entre as linhas, não do `padding-block`.

Medido em sete tamanhos (1920×1080/900/840, 1600×900, 1440×820, 1366×768, 1280×800): recheio lateral **36–47px**, vertical **19–34px**, `sobra 0` e zero overflow horizontal em todos.

**Antes de mexer de novo no padding porque "ainda está igual"**, descartar cache do navegador primeiro: o arquivo em disco, o servido pelo container (`docker compose exec frontend grep … /app/src/system.css`) e o que o dev server entrega (`curl localhost:3010/src/system.css`) já bateram os três iguais numa dessas rodadas — a pegadinha do chokidar (ver "Desenvolvimento local") **não** era a causa daquela vez. Pedir Ctrl+Shift+R antes de aumentar de novo.

> Receita de medição: `frontend/dist/harness.html` (gerado de um template com dados fictícios) + `chrome --headless --dump-dom` lendo um JSON no `<title>`. **O harness é uma cópia à mão do JSX** — já aconteceu de eu medir markup velho por ter esquecido de sincronizá-lo depois de mexer no componente.

> Receita de medição: `frontend/dist/harness.html` (gerado de um template com dados fictícios) + `chrome --headless --dump-dom` lendo um JSON no `<title>`. **O harness é uma cópia à mão do JSX** — já aconteceu de eu medir markup velho por ter esquecido de sincronizá-lo depois de mexer no componente.

O confete (`Confete`) sorteia as peças **uma vez** (`useMemo` sem dependência): o placar re-renderiza a cada 60s e a cada evento SSE, e re-sortear faria tudo saltar de lugar. Todas partem do mesmo topo e caem `100vh`; o que as espalha é o `animation-delay` **negativo**. Em `prefers-reduced-motion` o `.tv-cf` some inteiro — parado, vira sujeira fixa na tela.

### Escada do Resgate — agora horizontal (`EscadaFaixa` + `.tv-strip`)

A escada é cumulativa (quem chegou a 15 passou por 5 e 10), o que dá três estados por degrau — e só um deles é notícia:

| Estado | Quando | Tratamento |
|--------|--------|------------|
| `is-done` | `chegaram > 0` | Marca preenchida; "N chegaram" abaixo |
| `is-next` | degrau mais baixo com `chegaram === 0` | **Fronteira** — única coluna com fundo, aro grosso e nome próprio: "faltam N · FULANO" |
| `is-ahead` | acima da fronteira | Recua: marca vazada, título em `--muted`, trilho pontilhado |

- `degraus(ladder, board)` deriva os três estados. `board` chega **ordenado por contratos desc**, então `board.find(v => v.contracts < r.at)` é, por construção, quem está mais perto — não reordenar o board sem revisar isso.
- **Prêmio em R$ não vai ao telão** — decisão do cliente (ago/2026). `campaigns.ladder[].prize` e `ladder_step.prize` existem no banco e aparecem **só** no painel admin (`ShellCampaigns.jsx`). O telão fala em *giros*, e renderiza `campaign.spin_every` na linha "e segue: +1 giro a cada N recuperações" — sem ela a escada parece terminar no último degrau.
- O trilho continua existindo, agora **deitado** (`.tv-srung::before`, linha horizontal atrás das marcas): sólido no conquistado, pontilhado no horizonte. É ele que faz a escada ser uma rota e não uma lista — não trocar as marcas por cartões soltos.
- `grid-auto-flow: column` com `grid-auto-columns: minmax(…, 1fr)` + `overflow-x: auto`: colunas de largura igual, e **rola de lado** quando não couber. Encolher a marca até o número sumir seria trocar a escada por enfeite.
- `--gd-ink` (`#1C7A4D`) é o único verde que pode carregar **texto** — `--gd1` sobre `--accent-l` dá 2,4:1 e reprova em contraste.
- `< 1000px`: o corpo empilha, o pódio **deita** (`.tv-podio-cards { flex-direction: row }`) e a faixa da escada perde `.tv-srung-sub` e a linha de "e segue".

### Arquivo de campanhas legadas (Copa GD 2026 na lista de Campanhas)

A Copa GD 2026 (ranking por equipes) é um sistema **inteiramente separado** de `campaigns`/`CampaignBoard`: vive em `campaign_settings` (linha única, mutável) + `groups`/`score_events`, e é exibida por `ShellRanking.jsx` (telão "Ranking Equipe"/"Ranking Individual"), que **não é presa a nenhuma campanha** — sempre mostra o estado atual dessas tabelas. Como a Copa encerrou (31/07/2026) mas o pedido era ter um card dela na lista de Campanhas, era preciso decidir entre linkar ao vivo (simples, mas quebra silenciosamente se o sistema de equipes for reaproveitado numa campanha nova) ou congelar um snapshot. Decisão do cliente: **congelar**.

- **`campaigns.legacy_kind`** (coluna que já existia no schema, nunca usada) marca uma linha como arquivo do sistema antigo. Valor usado: `'team_scoring'`.
- **`campaigns.legacy_snapshot`** (JSONB, nova) guarda `{ groups, indRankings }` — a mesma forma que `ShellRanking.jsx` já consome ao vivo.
- **`POST /api/campaigns/archive-legacy`** (admin): tira a foto agora, chamando `fetchGroupsRanking()` (`routes/groups.js`, extraída de `GET /groups/ranking`) e `fetchIndividualRankings()` (`routes/scores.js`, extraída de `GET /scores/individual-rankings`) — as duas rotas viraram wrappers finos dessas funções, pra não duplicar SQL/chamada à NewCorban. Idempotente: se já existe uma linha `legacy_kind='team_scoring'`, faz `UPDATE` do snapshot em vez de duplicar. Botão correspondente em `ShellCampaigns.jsx` (`ArchiveLegacyButton`) — **precisa ser clicado manualmente uma vez em produção**, não roda sozinho no boot/seed (evita side-effect numa GET, e mantém controle explícito de quando o histórico é selado).
- **`GET /api/campaigns/:id/board`**: se `campaign.legacy_kind`, retorna `{ campaign, legacy: true, snapshot }` direto do banco — pula toda a lógica de NewCorban/escada/giro.
- **Frontend**: `Telao` (dentro de `ShellRanking.jsx`, já 100% presentacional — recebia os dados só via props) virou `export function Telao(...)`. `CampaignBoard.jsx` importa `Telao` e, se `data.legacy`, retorna só ele, pulando toda a UI de escada/giro do resto do componente.
- **`ShellCampaigns.jsx`**: linhas com `legacy_kind` escondem a linha "Produto X · franquia" e os controles de admin (datas/Ativar/Encerrar) do `CampaignRow` — não fazem sentido pra uma linha congelada.

#### Props do `Telao` — o mesmo componente serve TV e consulta

O `Telao` nasceu só para a TV. Reaproveitá-lo para um placar aberto no desktop exigiu tornar explícito o que era premissa fixa. Cada default preserva o comportamento do telão ao vivo; quem chama é que sobrescreve.

**Desde 13/08/2026 o `Telao` não tem mais dono** — a página que o abria saiu do menu. Restaram dois chamadores, ambos passando `modes` explícito:

| Chamador | `modes` | Origem dos dados |
|---|---|---|
| `CampaignBoard.jsx` (card arquivado) | `['teams','individual']` | `campaigns.legacy_snapshot` |
| `components/TelaoRankings.jsx` (botão 📺 nas páginas de ranking) | `['mensal','digitados']` ou o inverso | `/api/rankings/*` |

| Prop | Default (TV) | Quem sobrescreve | Por quê |
|------|--------------|----------------|---------|
| `groups` | `[]` | card arquivado | Com a lista vazia, a **régua de Meta Coletiva e o ticker somem** (`temEquipes`): as duas faixas são da competição por equipes e mostrariam "0 / —" e uma tira correndo em branco no telão do mês |
| `modes` | `['teams','mensal','digitados']` | os dois | Default hoje **não é usado por ninguém** — ficou como o que a TV era. Os modos `individual`/`today` existem só para o card arquivado; ver "Ranking Individual". Com 1 modo só, o auto-ciclo nem liga |
| `fullscreen` | `true` | card arquivado | `requestFullscreen()` era incondicional: **clicar no card sequestrava a tela**. "Ver o placar" abre normal; só "Abrir na TV" vai a tela cheia. O botão 📺 usa o default — ali tela cheia é a intenção |
| `limiteIndividual` | `5` | card arquivado (`Infinity`) | `TelaoIndView` tinha `.slice(0,5)` fixo. Cinco linhas é o que se lê a 4 m e a TV rotaciona sozinha; no arquivo, aberto de perto, a lista vem inteira. **Só afeta o modo legado** — `mensal`/`digitados` mostram a lista inteira rolando |

- **Troca manual de ranking**: botões `.tl-hd-mode` no cabeçalho. Clicar seta `tlManual` e **desliga a rotação automática** — sem isso a tela pularia no meio da leitura, pior do que não ter botão. Na TV, onde ninguém clica, o comportamento é idêntico ao de antes.
- **Rolagem**: soltar o limite não bastava — `.tl-body` é `overflow:hidden` e dezenas de linhas vazavam. `.tl-ind-list` rola dentro da coluna com o cabeçalho fixo; `.tl-ind-col-n` mostra o total ao lado do título.
- Título do cabeçalho usa `campaign?.name` (o placar arquivado mostra "Copa GD 2026"), com fallback `'RANKING GD'`.

### Abas de fase em `ShellCampaigns.jsx`

`Todas · Ativas · Concluídas · Futuras`, com contagem por aba (`.camp-tabs`/`.camp-tab` em `shell.css`).

`faseDaCampanha(c, hoje)` classifica por **data, não só por `status`**: uma campanha de um dia fica `status='active'` para sempre se ninguém clicar em "Encerrar" — pela data ela já acabou, e é em Concluídas que a pessoa procura. Ordem: `closed` → concluídas; `end_date < hoje` → concluídas; `start_date > hoje` → futuras; senão ativas.

Datas são comparadas como **string `YYYY-MM-DD`**, nunca via `new Date()`: `new Date('2026-08-10')` é UTC e vira 09/08 21h no BRT, mordendo um dia. `hoje` vem de `toLocaleDateString('en-CA')`, que já emite `YYYY-MM-DD` no fuso local.

### Endpoint `GET /api/campaigns/:id/board` — latência

O caminho frio custa **duas idas à NewCorban**: `getProposalsV3` (pagas no dia, empresa inteira, paginado 100/página em série) e `listarEquipe` via `getSellerIdsPorFranquia` (`equipe.php`, cadastro completo). Elas são independentes e vão em `Promise.allSettled` — a rejeição é relançada na ordem original (propostas → cadastro → robôs → `ranking_exclusions`) para o `detail` do 502 continuar sendo o mesmo.

> `allSettled` e não `all`: com `all`, a promise perdedora rejeitaria sem dono e cairia no `unhandledRejection` do `server.js`.

Frescor por idade do dia (constantes no topo de `campaigns.js`):

| | propostas (v3) | resposta HTTP |
|---|---|---|
| Dia corrente (`day === hoje`) | `TTL_DIA_VIVO` 60s | `CACHE_DIA_VIVO` 30s |
| Dia encerrado (`day < hoje`) | `TTL_DIA_ENCERRADO` 10 min | `CACHE_DIA_ENCERRADO` 10 min |

O dia corrente ficou **igual ao que era** — quem está vendendo continua vendo a própria venda entrar. Só o dia encerrado, que não recebe venda nova, troca frescor por latência.

**`day` sai de `campaign.start_date`**, não de hoje (`req.query.date` sobrescreve). Campanha de vários dias mostra sempre o primeiro dia no telão.

O cálculo em si mora em **`services/campaignBoard.js`** (`montarPlacar`), e não na rota, porque tem dois consumidores: o endpoint ao vivo e o congelador. Se divergirem, o número congelado deixa de ser o que o telão mostrou.

### Fonte das propostas — v3 com fallback para a API antiga

`buscarPropostasPagas()` escolhe a origem em tempo de execução:

| Condição | Fonte | `diagnostics.source` |
|---|---|---|
| `NEWCORBAN_PROPOSALS_TOKEN` definido | v3 (`developers.newcorban.com.br`), `stage=paid` | `v3` |
| Token ausente | API antiga (`POST api.newcorban.com.br/api/propostas/`), `tipo=pagamento` | `legado` |

Sem o fallback, a falta do token derrubava o placar inteiro (`Placar indisponível`) — e o token é fácil de perder, porque o `.env` é gitignored e não tem backup. As credenciais da antiga (`NEWCORBAN_API_USERNAME`/`PASSWORD`) já são exigidas pelo app para outras coisas.

**As duas devolvem o mesmo formato** — `convertV3Proposal` foi escrita imitando o da antiga. Conferido contra a API real em 11/08/2026: `vendedor_id` vem como número e `datas.pagamento` como `"2026-08-10 08:17:06"`, mas `montarPlacar` já normaliza com `String(...)` e `.slice(0,10)`.

**Diferenças que o fallback cobre:**
- A v3 filtra `stage=['paid']`; a antiga não tem esse filtro → registros com `api.status_api === 'CANCELADA'` ou `datas.cancelado` são descartados em `buscarPropostasPagas`
- A antiga só enxerga **~30 dias** para trás e fixa `produto: ['7','13']` → campanha antiga ou de outro produto volta vazia. A guarda `paid_today === 0` do congelador impede que isso vire snapshot

O modo legado loga um aviso na primeira vez e marca `diagnostics.source: 'legado'` na resposta — sem isso, um placar servido pela API antiga seria indistinguível de um servido pela v3. **Continue configurando o token em produção**: a antiga é documentadamente instável (ver Jun/30 e Jul/28 no histórico de bugs).

### Congelamento do placar (`services/campaignFreezer.js`)

Decisão do cliente (ago/2026): o placar congela **uma vez**, na virada do dia, e não muda mais.

| Quando | O quê |
|---|---|
| Cron `5 0 * * *` (America/Sao_Paulo) | `congelarPendentes()` — 00:05 e não 00:00 para não disputar a virada com o cron de pontuação |
| Startup do `server.js` | mesma função — cobre o servidor estar fora do ar na virada |
| `POST /api/campaigns/:id/freeze` (master) | recongela à força; botão **🧊 Recongelar** em `ShellCampaigns.jsx`, só em campanha `closed` |

**Encerrar e congelar são passos separados.** "A campanha acabou" é fato do calendário; "o resultado foi salvo" depende da NewCorban responder. `congelarPendentes()` faz `marcarConcluida()` primeiro — `status = 'closed'` sai mesmo que o congelamento adie ou falhe — e só então tenta gravar o snapshot. Sem isso, uma API fora do ar deixava a campanha `active` no banco enquanto a tela já a mostrava em "Concluídas" (o `faseDaCampanha` do `ShellCampaigns.jsx` classifica por data), e ela subia ao topo da lista pelo `ORDER BY (status = 'active') DESC`.

Como `pendentes()` filtra por **ausência de resultado**, não por status, a campanha encerrada-mas-não-congelada continua na fila e tenta de novo a cada passada.

- **Pendente** = `end_date < hoje` **e** sem linhas em `campaign_results` **e** `legacy_kind IS NULL`
- Congelar grava `campaign_results` + `campaigns.frozen_diagnostics` + `status = 'closed'`, tudo em transação
- Depois invalida `/api/campaigns/:id/board` no `responseCache` — senão o telão serviria a versão pré-congelamento por até 10 min
- **Guarda contra leitura ruim:** se `diagnostics.paid_today === 0` (nenhum contrato pago na empresa inteira naquele dia), **adia** em vez de gravar zero para sempre. Erro na API idem — nada é gravado e a próxima passada tenta de novo. Falha de uma campanha não impede as outras
- `force` (o botão) ignora as duas guardas
- Pagamento confirmado pelo banco **depois** da meia-noite não entra sozinho — é para isso que existe o Recongelar

**Forma da resposta congelada.** `lerCongelado` reaplica `ladderFor(contracts, …)` para devolver `next_at`, `next_prize` e `missing`, e lê `diagnostics` de `campaigns.frozen_diagnostics`.

> **BUG HISTÓRICO (corrigido antes de estrear):** o ramo congelado devolvia só as colunas da tabela — sem `next_at`/`missing`/`diagnostics`. O telão lê `item.missing === null` para decidir o texto, e `undefined === null` é falso: teria renderizado **"faltam undefined para o próximo giro"**. Como nada escrevia em `campaign_results`, esse caminho nunca tinha executado.

`?date=` em campanha encerrada **ignora o snapshot** e reconstrói: o congelado responde pelo dia da campanha, não por uma data arbitrária.

Colunas adicionadas: `campaign_results.team`, `campaigns.frozen_diagnostics JSONB` (migrations).

---

## Ranking Individual (mensal + digitados do dia)

> Substituiu, em 12/08/2026, os dois modos que liam a Copa: o "Ranking Individual" (que usava o período da `campaign_settings` e só quem estava em equipe ativa) e o "Pontos do Dia" (que lia `score_events`).

**Não existe reset.** "Zera todo mês" e "zera todo dia" são a **janela da consulta**, não um evento: dia 1º às 00:00 o mês novo já começa vazio porque a janela passou a apontar para outro intervalo. Não há tabela para limpar, cron de virada nem `daily_calculations` — todo o maquinário de `score_events`/`scoring.js` fica fora deste caminho.

### A fonte é o `ranking.php`, não a v3

| Quero | Chamada | Medido em 12/08/2026 |
|---|---|---|
| Ranking mensal | `getRankingPeriodo(inicio, fim, 'pagamento')` | **~1,8 s**, 1 requisição |
| Digitados do dia | `getRankingPeriodo(dia, dia, 'cadastro')` | **~1,6 s**, 1 requisição |

A v3 paginada (`getProposalsV3`, 100/página em série) levou **mais de 9 minutos** para o mesmo mês da empresa inteira. Para agregado por vendedor ela é a ferramenta errada — **não trocar de volta**.

Campos por vendedor: `filter_value` (=corban_id), `qtd_propostas`, `valor_referencia`, `valor_liberado`, `valor_financiado`, `valor_meta` e a **foto de perfil**, escondida em `second_level[nome].image` (é dela que sai o avatar; o fallback são as iniciais).

### Decisões do cliente (12/08/2026)

| Decisão | O que significa |
|---|---|
| **Escopo: empresa inteira** | Matriz **e** franquias. `getSellerIdsPorFranquia` não entra aqui — só o filtro de contas não-humanas. São ~64 no mês e ~45 nos digitados, contra 22 se fosse só matriz |
| **Mensal ordena por R$ pago** | Contratos desempatam. O `valor_meta` aparece como **apoio**, nunca como ordem |
| **A linha de apoio mostra a meta em R$, não o %** | Decisão de 13/08/2026. A meta da NewCorban é derivada do contrato, então o atingimento saía sempre entre 200% e 500% — número que não informa nada. O painel da NC mostra "Meta: R$ …"; a linha agora mostra o mesmo. `atingimento` **continua** no payload (`rankingIndividual.js`, `monthlyFreezer.js`) e no `scripts/verificar-ranking.js` — só saiu da tela |
| **"Rei das Assistências" saiu** | Era regra da Copa (INDICACAO). O modo virou uma lista só |
| **Mês fechado congela** | E não se mexe mais — por isso **não há botão de recongelar**, ao contrário do `campaignFreezer` |
| **Lista rolando na TV** | Todo mundo aparece em algum momento; um top 10 fixo esconderia 80% da lista |

Premissas assumidas, não perguntadas: produtos `['7','13']` (o que o resto do app usa) e **sábado e domingo contam** — o recorte de dia útil (`businessDays.js`) era regra da Copa e não existe no ranking da NewCorban.

### Contas não-humanas — `services/rankingFilters.js`

Extraído do `campaignBoard.js` porque agora tem dois consumidores. **Este filtro não é opcional:** sem ele o pódio dos digitados de 11/08/2026 seria NOVA IA (270 contratos) e Jarvis (268), contra 36 do primeiro humano.

Duas camadas que cobrem coisas diferentes:
- `getRoboSellerIds()` — flag `robo` do cadastro (38 contas). Pega "NOVA IA", que não casa com padrão de nome nenhum
- `ranking_exclusions` — padrões (`API%`, `BOT %`, `ROBO%`, `%(Matriz)%`)

**Se as duas falharem, `agregar()` lança** em vez de servir um ranking liderado pela IA numa TV. Se só uma falhar, degrada e marca `cadastro_ok`/`exclusoes_ok` no diagnóstico.

### Endpoints — `routes/rankings.js`

| Rota | Fonte | TTL |
|---|---|---|
| `GET /api/rankings/mensal?mes=YYYY-MM` | mês corrente: NewCorban · mês fechado: `monthly_rankings` | 60 s / 10 min |
| `GET /api/rankings/digitados?date=` | NewCorban | 60 s / 10 min |
| `GET /api/rankings/meses` | `monthly_ranking_meta` + o mês corrente | 60 s |

- **O congelado vence a API**, mas só para mês que não é o corrente. Mês passado ainda sem foto cai no ao vivo em vez de devolver vazio
- Mês/data malformados são **400**, não 502 — o erro é de quem pediu

### Congelamento — `services/monthlyFreezer.js`

| Quando | O quê |
|---|---|
| Cron `20 0 1 * *` (America/Sao_Paulo) | `congelarMesesPendentes()` — 00:20 para não cair junto do congelamento de campanhas (00:05) |
| Startup do `server.js` | mesma função — cobre o servidor estar fora do ar na virada |

- **Pendente** = mês encerrado (até 6 para trás) sem linha em `monthly_ranking_meta`. O mês corrente nunca é candidato
- **Guarda contra leitura ruim:** mês com zero participante na empresa inteira **adia** em vez de gravar zero para sempre. Como a fila filtra por ausência de foto, ele volta na próxima passada
- **Write-once**: mês já congelado é ignorado. Sem `force`, sem botão
- `atingimento` é **derivado na leitura**, nunca gravado — se ficasse na tabela, um arredondamento diferente faria o congelado divergir do ao vivo
- Tabelas: `monthly_rankings` (linhas) e `monthly_ranking_meta` (janela + totais + diagnóstico), em `migrateMonthlyRankings()`

### Frontend

`components/RankingIndividual.jsx` — as mesmas linhas no telão e nas páginas. As cores saem de tokens `--ri-*`: dentro do `.telao` apontam para a paleta escura da TV, fora seguem o tema do app.

**Os componentes velhos continuam de pé.** `TelaoIndView`/`TelaoTodayView` em `ShellRanking.jsx` são o renderizador do **snapshot congelado da Copa GD 2026** no card arquivado (`CampaignBoard.jsx` passa `modes={['teams','individual']}` e `indRankings` no formato `{melhor_vendedor, rei_assistencias}`). Reescrevê-los no lugar quebraria o arquivo em silêncio — por isso `mensal`/`digitados` são modos **novos**, ao lado. O mesmo vale para `fetchIndividualRankings()`, que `POST /api/campaigns/archive-legacy` ainda usa.

**Rolagem contínua (`.ri-scroll.ri-rola`):** a faixa contém a lista **duas vezes** e a animação anda exatamente 50% dela — ao voltar ao início, o que está na tela é idêntico ao instante anterior.

> ⚠️ O espaçamento entre linhas é `margin-bottom` da `.ri-linha`, **e não `gap` do `.ri-track`**. Com `gap`, a faixa de 2N linhas mede `2N·h + (2N−1)·gap`, e metade disso fica meio `gap` mais curta que uma cópia — a rolagem dá um pulo de 3px a cada volta. Medido em headless: com `margin-bottom`, `metadeDaFaixa − umaCopia = 0`.

- Lista curta não rola (`rolarAPartirDe`, 8 no telão, nunca nas páginas) — movimento sem motivo atrapalha a leitura
- Passar o mouse ou focar **pausa** a rolagem; `prefers-reduced-motion` desliga e devolve a rolagem manual
- Nome **quebra em vez de truncar** (`overflow-wrap: anywhere`) — nome cortado num ranking é falha
- `iniciais()` ignora palavras que não começam com letra: vários cadastros são "MOTIVACAO - JULIA KEI…" e saíam como "M-"

**Páginas:** `ShellRankingIndividual.jsx` (mensal + abas de mês) e `ShellRankingToday.jsx` (digitados + navegação por dia). Menu e títulos viraram **"Ranking do Mês"** e **"Digitados do Dia"**.

> As páginas ficam **montadas mesmo escondidas** (é o que dá a troca instantânea). Por isso recebem `ativo` do `Shell.jsx` — sem essa dica, as duas ficariam batendo na NewCorban a cada minuto com ninguém olhando.

#### Botão 📺 Telão — `components/TelaoRankings.jsx`

O botão do telão morava só no "Ranking Equipe". Removida aquela página (13/08/2026), tirá-lo junto levaria a **TV do escritório**, que é o ponto do produto — e ninguém pediu isso. Cada página de ranking ganhou o seu.

- Abre o `Telao` com os **dois** modos, começando pelo da página: mensal → `['mensal','digitados']`, digitados → o inverso. O auto-ciclo de 5 min alterna como na TV
- O modo da página chega **por prop, vivo**: a página continua montada atrás do telão e segue no polling dela. O outro modo é buscado aqui, no período corrente, e **recarregado a cada 2 min** — sem isso ficaria congelado na hora em que a TV foi ligada
- Se a página está mostrando um **mês/dia passado**, é ele que vai ao telão — é o que a pessoa está olhando
- `groups={[]}`: sem equipe, o telão esconde a régua de Meta Coletiva e o ticker (ver "Props do `Telao`")
- O fundo de campo e as cores de futebol ficam restritos ao telão do snapshot arquivado da **Copa GD** (`campaign.legacy_kind = 'team_scoring'`, classe `.tl-copa-campanha`). O telão de `mensal`/`digitados` usa fundo neutro; páginas normais e campanhas novas não recebem a identidade da Copa.

### Conferência

`node scripts/verificar-ranking.js [YYYY-MM] [YYYY-MM-DD]` — roda o serviço real contra a API, sem banco (stub devolve os padrões de exclusão da migration) e sem escrever nada. Serve para bater os números com o painel da NC antes de expor na TV.

> O relatório sai por `fs.writeSync(1, …)`, não por `console.log`. No Git Bash (mintty) o Node enxerga o stdout como **pipe**, e a escrita assíncrona se perdia na saída do processo: o script terminava com exit 0, sem erro e **sem tabela nenhuma** — só as linhas de log dos serviços. Rodar com `--trace-exit` fazia o relatório aparecer, porque atrasava a saída o suficiente. Não trocar de volta para `console.log`.

---

### Testes

`npm test --prefix backend` (runner nativo do Node, sem dependência nova) — `backend/test/`:
- `responseCache.test.js` — HIT/MISS, expiração, isolamento por query string, `res.locals.cacheTtlMs`, invalidação por prefixo
- `board.test.js` — agregação do placar (filtros de produto/franquia/robô/mesmo-dia, escada, diagnóstico), paralelismo, TTL por idade do dia, 502 preservado, caminho congelado e seus campos
- `freezer.test.js` — fila de pendentes, gravação em transação, idempotência, `force`, guardas contra leitura ruim, isolamento de falha entre campanhas
- `rankingIndividual.test.js` — janela do mês (fevereiro, bissexto, mês futuro), filtro de robô nas duas camadas e a recusa quando as duas falham, ordenação e desempate, procedência/foto ausentes, TTL por idade da janela
- `monthlyFreezer.test.js` — fila que nunca inclui o mês corrente, gravação em transação, write-once, guarda contra mês vazio, isolamento de falha entre meses, `atingimento` recalculado na leitura
- `rankingRoutes.test.js` — congelado vence a API, mês sem foto cai no ao vivo, 400 vs 502, isolamento de cache por query string
- `campaignAccess.test.js` — política pura de quem vê/cria/edita campanha: escopo do franqueado imposto sobre o corpo, escopo vazio recusado, rascunho, campanha da matriz é só leitura, `franquia_ids` fora dos campos editáveis
- `campaignRoutes.test.js` — a política ligada no HTTP, com tokens JWT de verdade: 403 por id alheio, **cache do placar não fura a permissão**, `franquia_ids` do corpo ignorado no POST e barrado no PUT, congelar é da matriz
- `externalApiRetry.test.js` — o retry de token do `ranking.php` (ver abaixo). Stuba só o `axios`; **falha por estouro de prazo** se a regressão voltar, porque é essa a forma do bug: ele não lança, emudece

Os testes injetam stubs em `require.cache` para `config/db`, `middleware/auth`, `services/externalApi` e `services/franquiaSellers` — não precisam de banco nem de credenciais.

### Outros

- `main.jsx`: **sem** `React.StrictMode` (causava double-mount e double requests em dev)
- `useEffect` depende de `group?.id` (não do objeto `group`) para evitar re-renders por referência
- `MembersModal.jsx`: abas Propostas (stats) e Pontos do Grupo; breakdown com ×2 Brasil; aviso em fim de semana

---

## Deploy

> ⚠️ **O que roda hoje em produção é VPS + PM2 + nginx — ver [`DEPLOY.md`](DEPLOY.md).**
> As duas seções abaixo (Modo Split e Hostinger Website Builder) descrevem
> alternativas que **não** estão em uso. Verificado por SSH em 11/08/2026:
> `/opt/copa-gd` na `191.252.159.244`, PM2 app `copa-gd`, Express servindo o
> `frontend/dist` na 3001, nginx em https://copa.grupodigitalsf.com.br.
> Não há CI: `git push` não faz deploy.

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
| `CORS_ORIGIN` | Backend `.env` | URL do domínio do frontend. O domínio real é **`copa.grupodigitalsf.com.br`** (com `sf`) — não `copa.grupodigital.com.br`, que não existe e já custou tempo de diagnóstico. Hoje é desnecessário: com `SERVE_STATIC=true` a API e o front saem da mesma origem |
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

Log esperado em produção: `🏆 Ranking GD rodando em http://0.0.0.0:PORT (API + frontend)`.  
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
| `NEWCORBAN_PROPOSALS_TOKEN` | **Sim** | Bearer token da API v3 (`nc_live_...`) — scoring usa essa API para buscar propostas sem limite de 30 dias |

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

**ARMADILHA — o frontend no Docker não recarrega sozinho no Windows.** O `docker-compose.yml` define `CHOKIDAR_USEPOLLING` **só no serviço `backend`**. Bind mount do Docker Desktop (Windows/macOS) não emite evento de filesystem, então o Vite nunca invalida o módulo: o arquivo novo está dentro do container, mas o dev server continua servindo o transform em cache. **O sintoma engana** — a tela mostra o código antigo e parece que a alteração não foi feita.

Diagnóstico rápido (compara o que o dev server entrega com o arquivo em disco):
```bash
curl -s http://localhost:3000/src/pages/ShellCampaigns.jsx | grep -c "algo-que-voce-acabou-de-escrever"   # 0 = cache velho
docker compose exec frontend grep -c "idem" /app/src/pages/ShellCampaigns.jsx                            # 1 = arquivo OK
```

Correção sem tocar no `docker-compose.yml` — `docker-compose.override.yml` na raiz, que o compose aplica automaticamente:
```yaml
services:
  frontend:
    environment:
      CHOKIDAR_USEPOLLING: "true"
      CHOKIDAR_INTERVAL: "400"
```
Depois `docker compose up -d --force-recreate frontend`.

O mesmo arquivo serve para remapear porta quando a 3000 já está ocupada por outro projeto:
```yaml
    ports: !override
      - "3010:3000"
```
**`!override` é obrigatório aqui** — sem ele o compose **soma** as listas em vez de substituir, mantém o bind na 3000 e o `up` continua falhando com "port is already allocated". O erro engana, porque o `config` mostra as duas portas e parece que funcionou.

> ⚠️ **`docker-compose.override.yml` hoje está versionado** e não consta no `.gitignore`. Isso é um problema: remapeamento de porta é específico da máquina de quem desenvolve (depende de qual outro projeto está ocupando a 3000), e versionado ele muda a porta de todo mundo. Convenção do Docker é este arquivo ser local — vale mover para o `.gitignore` (`git rm --cached docker-compose.override.yml`) e deixar cada um ter o seu.

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
| Jun/23 | `individual-rankings` sempre retornava arrays vazios | 3 causas: (1) `end_date = NULL` → `new Date(null)` = epoch `"1970-01-01"` → API sem propostas; (2) `getProposals` sem filtro de vendedor → busca toda a empresa (timeout); (3) `responseCache` cacheava resultado vazio. Fix: `endRaw && endRaw < today ? endRaw : today`; passar `[...activeCorbans]` ao `getProposals`; `responseCache` ignora arrays vazios |
| Jun/26 | SSE `clients` Set crescia ilimitado sob nginx da Hostinger | `req.on('close')` não dispara quando nginx fica no meio. Corrigido: limite `MAX_SSE_CLIENTS=50` + remoção proativa no catch do keepalive ping |
| Jun/23 | `DELETE /api/admin/adjustments/:id` sem `authMiddleware` | Qualquer usuário podia deletar ajustes de pontos sem autenticação. Adicionado `authMiddleware, configAdminOnly` |
| Jun/23 | Contagem de membros incluía usuários inativos no limite | `COUNT(user_id)` sem `JOIN users WHERE active=true` fazia membro desativado ocupar vaga — bloqueava adição do 6º jogador. Corrigido nas 3 queries de verificação de capacidade |
| Jun/23 | `torcidaMap` undefined em TORCIDA_ORGANIZADA retroativa | Se fetch do ranking histórico falhava, `vendorMapByDate[dateStr]` era `undefined` e `.every()` lançava TypeError. Corrigido: `|| {}` no fallback |
| Jun/23 | `parseFloat(null)` retornava `NaN` em `scoringRules.js` | Se `base_points` fosse NULL no banco, pontuação ficava `NaN`. Corrigido: fallback para `FALLBACK[rule] || 0` quando `isNaN(pts)` |
| Jun/23 | Metas CLT/FGTS removidas; bônus de meta passaram de percentuais para valores fixos | Colunas CLT/FGTS ficam no banco (legado). Adicionadas `daily_goal_meta2` e `daily_goal_meta3` — thresholds fixos independentes para Meta 2 (10 pts) e Meta 3 (15 pts). META_DIA_PLUS100 removido. ShellConfig: tabela de metas atualizada. Seed: regras CLT/FGTS/PLUS100 deletadas do banco |
| Jun/23 | Pontos perdidos em massa no ranking a cada rodada do cron | 2 causas: (1) `getProposals` lançava exceção → `allProposals=[]` → cron deletava CONVERSAO, INDICACAO, CONTRATO_10K para todos os grupos sem re-inserir; (2) `getRanking` lançava exceção → `vendorMap={}` → TORCIDA deletada para todos. Corrigido: flag `proposalsOk` — se `getProposals` lança, `return []` imediatamente (abort); flag `rankingOk` — se `getRanking` lança, TORCIDA é preservada (`torcidaDataAvailable`) |
| Jun/23 | Cron documentado como "15 min" mas rodava a cada 5 min | `scheduler.js` usa `*/5 * * * *`. Corrigido no CLAUDE.md |
| Jun/25 | CONTRATO_10K tratado como regra de campanha acumulada (sem ×2) | Corrigido para regra diária: `event_date = dateStr`, aplica `mult` (×2 em dia de jogo). `OUTROS_RULES` em `groups.js` agora só contém `INDICACAO` |
| Jun/25 | CONVERSAO incluía propostas CANCELADA no denominador | `gDayConversao = gDay.filter(p => p.api?.status_api !== 'CANCELADA')` — campo aninhado em `p.api.status_api`, não top-level |
| Jun/30 | Cron zerava eventos históricos de dias de jogo (double_points) | `canDelete = isToday \|\| isForce` — cron automático só apaga eventos do dia atual; dias passados só são limpos via recálculo manual (force) |
| Jun/30 | GOL_DE_PLACA e CONTRATO_10K contavam por data de cadastro | Corrigido: ambos usam `gPaidOnDate` (data de pagamento = dateStr), igual a META_DIA e ARTILHEIRO |
| Jun/30 | ARTILHEIRO contava apenas contratos com cadastro na campanha | `getProposals` agora busca de `hoje-30 dias` (não só `campaignStart`) para capturar contratos submetidos antes da campanha mas pagos durante ela. API limita a 31 dias. `rawProposals` (sem filtro de weekday cadastro) usado para regras por data de pagamento; `campaignWeekdayProposals` (cadastro na campanha, dia útil) para CONVERSAO e INDICACAO |
| Jun/30 | INDICACAO e CONTRATO_10K oscilavam a cada 5min | API NewCorban retornava `{}` (sem `error:true`) em rodadas alternadas → `proposalsOk=true` mas `rawProposals=[]` → cron deletava eventos. Fix: (1) INDICACAO: `else` → `else if (isForce)` — cron nunca remove evento histórico acumulado; (2) guard de sanidade: `rawProposals.length < allCorbanIds.length` aborta o cálculo (cobre tanto resposta vazia quanto resposta parcial que zerava force recalc) |
| Jul/20 | Force recalc zerava eventos de datas > 30 dias atrás / API rejeitava período > 31 dias | A API NewCorban retorna 502 para `startDate` anterior a ~30 dias. Chunking foi tentado mas a API também rejeita chunks com `endDate` histórico (502). Fix definitivo: `earlyStart = max(campaignStart, hoje-30)` — janela real da API. Em force recalc, datas anteriores a `earlyStart` são puladas (sem deletar), preservando eventos históricos. INDICACAO só é deletada em force se `campaignStart >= earlyStart`. `scores.js` (individual-rankings e today-activity) também usam `earlyStart`. |
| Jul/23 | META_SEMANA histórica zerada em force recalc | Loop de semanas em force processava TODAS as semanas incl. antes de `earlyStart`. `rawProposals` não cobre esse período → `weekProps=[]` → evento deletado sem re-inserir. Fix: `if (isForce && wsStr < earlyStart) continue` no início do loop de semanas. |
| Jul/23 | INDICACAO reduzida a cada cron/force quando campanha > 30 dias | `campaignWeekdayProposals` cobre só `earlyStart→hoje`. Contratos de Indicação anteriores a `earlyStart` somem da janela → `upsertEvent` sobrescrevia pontos históricos com valor menor. Fix: quando `campaignStart < earlyStart`, usa `ON CONFLICT DO UPDATE SET points = GREATEST(...)` — nunca reduz pontos. |
| Jul/28 | META_DIA/META_SEMANA/GOL/ARTILHEIRO/CONTRATO_10K não contavam contratos registrados antes da janela de 30 dias | `getProposals` usava `tipo: 'cadastro'` — filtrava por data de registro. Contratos registrados antes do earlyStart mas pagos dentro da janela eram invisíveis. Fix: duas chamadas à API — `tipo: 'pagamento'` para `rawProposals` (regras por data de pagamento) + `tipo: 'cadastro'` para `campaignWeekdayProposals` (CONVERSAO/INDICACAO). `externalApi.getProposals()` aceita parâmetro `tipo` (default `'cadastro'`). |
| Jul/28 | Force recalc removia META_DIA/META_SEMANA de datas históricas dentro da janela 30 dias | A API filtra propostas por data de **cadastro** (earlyStart→hoje). Proposta registrada antes de earlyStart mas **paga** em data histórica (ex: cadastro 20/jun, pago 29/jun, earlyStart 28/jun) some da janela → recalc retorna 0 → evento deletado. Fix: `canDelete = isToday` (não `isToday\|\|isForce`) — eventos históricos só sobem via upsert, nunca são removidos em force. DELETE upfront só roda para hoje. |
| Jul/28 | tipo=pagamento retorna 2 registros intermitentemente (API NC instável) | A API NewCorban retorna ocasionalmente respostas truncadas para `tipo='pagamento'`. Fix: fallback automático — se `rawProposals.length < allCorbanIds.length`, usa `cadastroProposals` no lugar. Log: `⚠️ tipo=pagamento retornou N (esperado >=M) — fallback para cadastro`. Mesmo fallback em `individual-rankings`. |
| Jul/30 | Pontos não contavam desde início da campanha (17/06) — API velha rejeitava datas > 30 dias | Substituída por API v3 `developers.newcorban.com.br/v1/proposals` com token Bearer sem limite de janela. `getProposalsV3()` usa `campaignStart→today` com paginação. Removidos: `earlyStart`, guards de loop e META_SEMANA, lógica GREATEST do INDICACAO. `canDelete = isForce \|\| isToday`. Requer `NEWCORBAN_PROPOSALS_TOKEN` no `.env`. |
| Jul/28 | Force recalc removia META_DIA/META_SEMANA de datas históricas dentro da janela 30 dias | A API filtra propostas por data de **cadastro** (earlyStart→hoje). Proposta registrada antes de earlyStart mas **paga** em data histórica (ex: cadastro 20/jun, pago 29/jun, earlyStart 28/jun) some da janela → recalc retorna 0 → evento deletado. Fix: `canDelete = isToday` (não `isToday\|\|isForce`) — eventos históricos só sobem via upsert, nunca são removidos em force. DELETE upfront só roda para hoje. |
| Jul/30 | API v3 retornava 429 (rate limit) com `per_page=500` causando 422; scoring abortava | `per_page=500` rejeitado pela API (máx=100). Fix: revertido para 100; retry com backoff 10/20/30s em 429; cache TTL v3 aumentado para 8 min (> intervalo do cron de 5 min). |
| Jul/30 | Scoring continuava calculando pontos após fim da campanha (31/07) | `scoring.js` passou a ler `end_date` de `campaign_settings`; usa `campaignEnd = min(end_date, today)` como teto do período; limpeza automática de eventos pós-`end_date` na primeira rodada. Leaderboard em `groups.js` e `scores.js` usa `LEAST(CURRENT_DATE, end_date)`. |
| Ago/11 | Placar da campanha demorava a abrir | Três causas somadas: (1) `broadcast('scores_updated')` chamava `invalidateResponseCache()` sem argumento e o cron, a cada 5 min, zerava o cache do placar junto com o dos scores — logo o clique quase nunca pegava cache quente, e a limpeza coincidia com o SSE mandando todos os telões recarregarem; (2) `getProposalsV3` e `getSellerIdsPorFranquia` eram aguardadas em série, somando duas idas à NewCorban; (3) o placar de um dia já encerrado, que não muda mais, era refeito a cada 60s. Fix: invalidação por prefixo (`SCORE_CACHE_PREFIXES = ['/api/scores']`), `Promise.allSettled` para as chamadas independentes, e TTL de 10 min para dia encerrado (dia corrente inalterado). Equivalência verificada em 1500 cenários aleatórios contra a versão anterior — JSON idêntico. |
| Ago/11 | Placar morria inteiro quando faltava `NEWCORBAN_PROPOSALS_TOKEN` | `getProposalsV3` lança na primeira linha se o token não existe, e o `.env` é gitignored sem backup — perder a linha derrubava placar, scoring e congelamento de uma vez, com a tela mostrando só "Placar indisponível". Fix: `buscarPropostasPagas()` cai na API antiga (`tipo=pagamento`, credenciais que o app já exige) quando não há token, descartando cancelada/estornada para compensar a falta do `stage=paid`. `diagnostics.source` diz qual fonte respondeu. |
| Ago/11 | Placar de campanha encerrada nunca congelava | `campaign_results` só era lida, nunca escrita — campanha encerrada reconstruía da NewCorban para sempre, e "Encerrar" no painel só trocava o rótulo. Fix: `services/campaignFreezer.js` + cron `5 0 * * *` + congelamento na startup + `POST /api/campaigns/:id/freeze` (botão Recongelar). Cálculo extraído para `services/campaignBoard.js`, compartilhado entre o endpoint ao vivo e o congelador. |
| Ago/11 | Ramo congelado devolveria `next_at`/`missing`/`diagnostics` ausentes | O telão renderizaria "faltam **undefined** para o próximo giro" e perderia a linha "N contratos não entraram". Nunca apareceu porque o caminho jamais executou. Fix: `lerCongelado` reaplica `ladderFor` e lê `campaigns.frozen_diagnostics`; `campaign_results.team` passou a ser gravada. |
| Ago/11 | `responseCache` cacheava por `req.path`, ignorando a query string | `?date=2026-08-05` e `?date=2026-08-10` compartilhavam a entrada do placar e um servia o dia do outro. Latente enquanto o `CampaignBoard` não mandava `date`, mas o TTL de 10 min para dia encerrado transformaria isso em dado errado na tela. Chave passou a ser `req.originalUrl`. |
| Ago/10 | Placar de campanha contava a empresa inteira; faltava restringir à matriz | Nova coluna `campaigns.franquia_ids TEXT[]` (NULL = todas as franquias) + `backend/src/services/franquiaSellers.js`, que monta o mapa vendedor→franquia a partir do cadastro de consultores do NewCorban (`getAllUsers`, cache 15 min). O nome do campo é resolvido por sondagem (`franquia_id`, `franchise_id`, `franquia.id`, `unidade_id`, `filial_id`…) porque não é documentado; se nenhum candidato existir, **lança** em vez de devolver conjunto vazio — filtrar por campo inexistente esvaziaria o telão em silêncio. **A matriz é a AUSÊNCIA de franquia, não um id** — consultor da sede vem com `franquia_id` nulo (equipes PROPÓSITO, GARRA, DETERMINAÇÃO, HOME, ADM, ABUNDANCIA); `franquia_id = 1` é a **Franquia Mauá**, desativada desde 2024. Por isso o token `'matriz'` em `franquia_ids`. Franquias reais: 6 Tatuapé, 7 Guarulhos Centro, 24 Gabriel Machado, 865 Indaiatuba. Missão Resgate fica com `ARRAY['matriz']`. Diagnóstico `other_franquia` na resposta do placar. Script `scripts/descobrir-franquia.js` mostra os campos reais do cadastro e a distribuição de valores. |
| Ago/10 | Data de cadastro da API v3 cortada da string crua — se `created_at` vier em UTC, contrato digitado após 21h BRT cai no dia seguinte | `convertV3Proposal` fazia `String(item.dates.created_at).slice(0,10)`, sem conversão de fuso. Fix: `toBrazilDateStr()` em `externalApi.js` converte para `America/Sao_Paulo` antes de extrair a data, **só** quando o valor traz fuso explícito (`Z` ou offset); timestamp ingênuo (`2026-08-10 14:32:11`) é horário local e é lido como está, então a função é no-op se a API nunca mandou UTC. Aplicado a `datas.cadastro` e `datas.pagamento` — atinge todo consumidor da v3. Blast radius antes do fix: na Copa a data de cadastro só alimenta CONVERSAO (taxa agregada) e INDICACAO (acumulado da campanha), ambas tolerantes a deslocamento de um dia — por isso nunca apareceu. Em campanha com `require_same_day` a data vira porteira por contrato e o erro fica visível. `scripts/verificar-placar.js` espelha a conversão e reporta quantos registros trazem fuso explícito. |
| Ago/11 | Nome do produto ainda dizia "Copa GD 2026" em todo canto visível, mesmo com a competição por equipes encerrada em 31/07 | Renomeado para **"Ranking GD"** — decisão já registrada em `PRODUCT.md` numa sessão anterior junto com o fim da identidade "Copa/futebol" (não revertida aqui: cores `copa-*`/emoji continuam, só o texto mudou). Trocado em: `index.html` (title), `Shell.jsx` (nome na sidebar), `Login.jsx` (hero + rodapé), `ShellRanking.jsx` (cabeçalho e ticker do telão de equipes), `ShellConfig.jsx` (nome padrão e hint do período), `server.js` (log de start), `shell.css` (comentário), `.env.example` + `backend/package.json` + `frontend/package.json` (descrições). **`campaign_settings.name`**: default novo em `seed.js` **e** `schema.sql` (bancos novos), mas o default só vale para banco vazio — quem já tinha a linha antiga (produção) ganhou `migrateCampaignSettingsName()` em `migrations.js`: `UPDATE ... WHERE name = 'Copa GD 2026'`, condicional para não sobrescrever se o admin já tiver renomeado pelo painel. Fora do escopo (não tocado): `localStorage` (`copa_token`/`copa_user`), cookie `copa_theme`, `package.json`/`website-builder.json` (`name: "copa-gd"`, identificador interno de build/deploy), e as páginas mortas `ShellDashboard.jsx`/`Ranking.jsx`/`admin/CampaignSettings.jsx` (existem no repo mas não são importadas por `App.jsx`/`Shell.jsx` — nunca renderizam). |
| Ago/11 | Sem jeito de ver a Copa GD 2026 (encerrada) na lista de Campanhas, junto das campanhas novas | Ver seção "Arquivo de campanhas legadas" acima. Resumo: `campaigns.legacy_kind`/`legacy_snapshot` (colunas novas — a primeira já existia sem uso), `POST /api/campaigns/archive-legacy` tira uma foto do ranking de equipes + individuais e grava pra sempre; `GET /:id/board` serve essa foto direto quando `legacy_kind` está setado; `CampaignBoard.jsx` reaproveita o `Telao` de `ShellRanking.jsx` (que virou export nomeado) em vez de montar uma view nova. Botão precisa ser clicado manualmente em produção — não roda no boot. Cobertura: 3 testes em `board.test.js` (snapshot servido sem tocar a NewCorban, legado vence `campaign_results`, snapshot ausente devolve forma vazia em vez de quebrar o telão). |
| Ago/11 | Reaproveitar o `Telao` no card arquivado expôs 3 premissas fixas de TV | (1) `requestFullscreen()` era incondicional — **clicar no card sequestrava a tela**; virou prop `fullscreen` (default `true`, o card herda o clique). (2) `TelaoIndView` tinha `.slice(0,5)` fixo — o arquivado mostrava só 5 dos 58 colocados; virou prop `limiteIndividual` (default `5` na TV, `Infinity` no arquivo) + `.tl-ind-list` com rolagem, porque `.tl-body` é `overflow:hidden` e a lista longa vazava. (3) Só havia rotação automática de 5 min — inaceitável para quem abre e quer ver o outro ranking; botões `.tl-hd-mode` no cabeçalho, e clicar **desliga** a rotação (`tlManual`) para a tela não pular no meio da leitura. |
| Ago/11 | Lista de campanhas sem filtro; campanha vencida continuava aparecendo como ativa | Abas `Todas/Ativas/Concluídas/Futuras` com contagem (`faseDaCampanha` em `ShellCampaigns.jsx`). Classifica por **data, não só por `status`**: uma campanha de um dia fica `active` para sempre se ninguém clicar em "Encerrar", mas pela data já acabou. Datas comparadas como string `YYYY-MM-DD` (`toLocaleDateString('en-CA')`) — `new Date('2026-08-10')` é UTC e vira 09/08 no BRT. |
| Ago/11 | Coluna esquerda do telão da Missão Resgate ocupava metade da altura e deixava um vazio grande | A escada abraça o próprio conteúdo (`flex: 0 1 auto`, decisão anterior para o painel não parecer "faltou carregar") e com 5 degraus sobrava meia coluna. Fix: a esquerda virou **palco escuro** com o pódio **Destaques** (top 3) + confete, e a escada foi **deitada** acima do ranking (`EscadaFaixa`/`.tv-strip`). Cartão portado do `.cc` de `copa_gd_painel_.html`, na variante escura + confete escolhidas pelo cliente. Ver seção "Telão de campanha". Contraria o `DESIGN.md` (seed nunca implementado) — divergência registrada, não resolvida |
| Ago/11 | Ao portar o cartão do protótipo: nome cortado ao meio e 3º cartão fora da tela | Duas causas medidas no Chrome headless: (1) `flex-shrink` livre comprimia o cartão abaixo da altura do conteúdo e o `overflow:hidden` comia a primeira linha — corrigido com `flex: 1 0 auto` + `.tv-podio-cards { overflow-y: auto }`; (2) com as duas linhas de números empilhadas, os 3 cartões pediam 649px numa coluna de 576 — corrigido fundindo `.tv-cc-meta` em `.tv-cc-figures`. Também: a medalha centrada na base do avatar cobria as iniciais (foi para o lado). Cabe exato em 1920×1080, 1600×900 e 1366×768 — **mexer em espaçamento ou corpo de fonte exige remedir** |
| Ago/11 | Cliente viu o cartão com dado real (janela com altura ≤860px, onde `.tv-cc-mi` já some por regra): medalha/avatar/nome grudados, selo de giro pequeno perto do "20" | `.tv-cc-top` gap subiu (`12→16-28px`); `.tv-cc-team` ganhou mais margem do nome. `.tv-cc-giros` cresceu bastante (padding, `font-size` de `14-22px` para `19-33px`) — ficou do tamanho do bloco de RECUPERAÇÕES (`.tv-cc-figures` virou `align-items: center` porque `flex-end` desalinhava as bases dos dois). Remedido nos 4 tamanhos-referência (1920×1080, 1600×900, 1366×768 **e 1440×820**, que é o cenário real da captura) — a folga continua zero por construção |
| Ago/11 | Cartão do pódio "estranho" mesmo depois de refeito — eu estava copiando o protótipo **errado** | Eu vinha portando o `.cc` do `copa_gd_painel_.html`; a referência do cliente era o `buildTop3Card()` do **`sales-arena.html`**, que ele acabou enviando. Diferenças que eu tinha errado: fundo quase preto (não marrom claro), sombra dourada (não preta), dois blobs radiais de brilho, medalha **separada** do avatar, selo de giros **pequeno** (12px, translúcido) e não uma pílula gigante, divisor de 1px entre os dados de apoio, avatar com anel e pulso, valor grande **branco**. Além disso eu tinha inventado dois elementos que não existem na referência: faixa metálica no topo e marca d'água do número. Refeito com os valores do arquivo. Ver seção "Pódio Destaques" |
| Ago/11 | O redesign "líder grande + 2º/3º em linha" foi **recusado** pelo cliente ("ficou pior… não quero card grande") | Revertido para **três cartões iguais** no arranjo exato da foto de referência. Para caberem, saiu o cabeçalho "CAMPANHA DO DIA / \<nome\>" da coluna — duplicava o nome da barra superior e a frase da campanha duplicava o "+1 giro a cada N" da escada (~145px de altura repetida). Somado: confete dentro do cartão, chip verde da equipe, "Nº LUGAR" acima do nome e valor grande em branco, tudo para bater com a foto. Corte progressivo por altura (≤860 e ≤800) porque abaixo de 1080p é o **piso dos `clamp()`**, não a escala, que estoura a coluna. **Lição:** o cliente fixou uma referência visual — quando ela e a análise divergem, perguntar antes de trocar a estrutura, não depois |
| Ago/11 | Depois de 3 rodadas de ajuste o cliente disse que o pódio continuava ruim → **redesign** (depois revertido, ver linha acima) | Os ajustes eram remendo: a medição dizia `sobra 0` em todos os tamanhos, ou seja, **zero folga por construção** — qualquer aumento tinha que roubar de outro lugar. Diagnóstico: (1) o pódio repetia as 3 primeiras linhas do ranking que está na mesma tela; (2) o cartão do protótipo carrega 11 dados, foi desenhado para uma barra lateral de 490px lida a 60cm; (3) quatro codificações redundantes de "1º lugar" (medalha + marca d'água + rótulo + dourado). Fix: `CardDestaque` virou `CardLider` + `LinhaPodio`, `.tv-cc` virou só superfície de metal, e a sobra da coluna passou a ser gasta em corpo de fonte (número do líder de 42→86px). Ver seção "Pódio Destaques" |
| Ago/11 | "ainda está igual": o pedido era a identidade **no topo** do cartão, e só o espaçamento horizontal tinha mudado | O cartão usava `justify-content: center`. Como ele **cresce** por `flex-grow`, a folga virava margem morta simétrica — medido no headless: **~11px acima e ~11px abaixo** do conteúdo, em todos os três cartões. Trocado por `justify-content: space-between`: a mesma folga passa a separar medalha/nome ↔ números ↔ progresso, com a identidade ancorada no topo e a barra no rodapé. Nada encolheu. `gap` voltou a ser só piso (`5-10px`) — subir os dois somava e estourava 768p em 41px. Selo de giros de novo maior (`23-40px`), com recheio vertical menor, porque é a fonte que faz parecer grande e o padding só rouba altura. `.tv-cc-mi-lbl` ganhou `white-space: nowrap` — com o selo maior, "PRÓXIMO GIRO" quebrava em duas linhas a 1080p |
| Ago/11 | Alteração no frontend não aparecia no Docker local (Windows) — parecia que o código não tinha sido salvo | O `docker-compose.yml` define `CHOKIDAR_USEPOLLING` só no `backend`. Sem evento de filesystem no bind mount, o Vite servia o transform em cache: **o arquivo novo estava no container, mas a tela mostrava o código antigo**. Correção em `docker-compose.override.yml` com polling no `frontend`. Diagnóstico e receita na seção "Desenvolvimento local" — inclui o alerta de que esse override está versionado e provavelmente não deveria. |
| Ago/12 | Ranking individual e "Pontos do Dia" ainda eram da Copa (encerrada em 31/07): período da `campaign_settings` e só quem estava em equipe ativa | Viraram **Ranking do Mês** (pagos do mês, por R$) e **Digitados do Dia** (digitados, por quantidade), empresa inteira. Ver seção "Ranking Individual". O reset sumiu: a janela da consulta é o mês/dia, então a virada acontece sozinha — sem tabela, sem cron de zeragem. Fonte trocada para `ranking.php` (`getRankingPeriodo`): ~1,8s numa requisição contra **mais de 9 minutos** da v3 paginada para o mesmo mês. `getRoboSellerIds` + `ranking_exclusions` extraídos para `services/rankingFilters.js` — sem eles o pódio dos digitados seria NOVA IA (270) e Jarvis (268) contra 36 do primeiro humano |
| Ago/12 | Ao reaproveitar a view do ranking individual, o card arquivado da Copa quebraria em silêncio | `TelaoIndView`/`TelaoTodayView` **também** renderizam o snapshot congelado da Copa GD 2026 (`CampaignBoard.jsx` passa `indRankings` no formato `{melhor_vendedor, rei_assistencias}`), e `fetchIndividualRankings()` ainda serve o `POST /archive-legacy`. Por isso `mensal`/`digitados` entraram como modos **novos** ao lado, e nada do caminho legado foi tocado |
| Ago/12 | A rolagem contínua do telão dava um pulo de 3px a cada volta | A faixa duplica a lista e anda `translateY(-50%)`, mas com `gap` no `.ri-track` a faixa de 2N linhas mede `2N·h + (2N−1)·gap` — metade disso é meio `gap` mais curta que uma cópia. Trocado por `margin-bottom` na `.ri-linha`; medido em headless: `metadeDaFaixa − umaCopia = 0` |
| Ago/12 | `setInterval` de faxina do cache em `externalApi.js` segurava o processo aberto para sempre | Qualquer script ou teste que só importasse o módulo nunca terminava (e `process.exit(0)` como remendo truncava o stdout redirecionado, deixando relatório vazio). Fix: `.unref()` no timer |
| Ago/12 | **Ranking do Mês estourava o timeout de 30s do navegador** | Não era o ranking: o cron de pontuação continuava recalculando a Copa (encerrada em 31/07) a cada 5 min, baixando a campanha inteira da v3 em duas chamadas paginadas de 100+ páginas, respondendo `429` e esperando 10/20/30s por página. Como o NewCorban é o mesmo para o app inteiro, o ranking ficava na fila. Medido: `mensal?mes=2026-08` → **304s e falha**, meses congelados → 11–25ms; depois da guarda → **2s**. Fix: `calculateScores` retorna cedo no modo cron quando `end_date < hoje` (force continua reprocessando). **O mesmo estava acontecendo em produção desde 01/08** |
| Ago/12 | `scripts/verificar-ranking.js` terminava com exit 0, sem erro e **sem relatório nenhum** | No Git Bash (mintty) o Node vê o stdout como pipe e o `console.log` é assíncrono: o processo saía antes de esvaziar o buffer. Rodar com `--trace-exit` fazia o relatório aparecer, atrasando a saída o bastante — sintoma que joga o diagnóstico para o lado errado. Fix: `fs.writeSync(1, …)` |
| Ago/12 | Qualquer usuário logado via **todas** as campanhas, e só a matriz podia criar | Fase 1 de campanhas por franquia: role `franqueado` + `admin_franquia_scopes` + `campaigns.owner_franquia_id`, política em `services/campaignAccess.js`, `GET /api/franquias`, wizard de criação (`components/CampaignForm.jsx`) e cadastro de donos (`components/FranqueadosConfig.jsx`). Ver seção "Donos de franquia". Duas armadilhas fechadas por teste: escopo vazio viraria campanha da empresa inteira (`franquia_ids = []` = sem filtro no placar) e a checagem do `/board` dentro do handler seria pulada pelo `responseCache` |
| Ago/12 | Páginas de ranking batiam na NewCorban a cada minuto mesmo escondidas | O `Shell.jsx` mantém todas as páginas montadas (é o que dá a troca instantânea). Passou a mandar `ativo`, e o polling só roda na página visível |
| Ago/13 | **"Digitados do Dia" dava timeout no navegador; "Ranking do Mês" parecia são** | Não era lentidão da NewCorban — a API respondia em 0,8s (digitados) e 1,2s (mensal) medida de dentro da VPS. O processo é que **pendurava para sempre**: o `ranking.php` responde 200 com erro de token no corpo, e o retry de `getRankingPeriodo`/`getRankingByPayment` recursava na **função pública**, caindo no dedup do `_inflight` e recebendo de volta a promise que estava esperando por ele. Promise dependendo de si mesma; ciclo de comprimento 2, que o V8 não detecta — nada lançava, o `.finally` nunca rodava e a **chave ficava presa no `_inflight` para sempre**. Medido em produção: `digitados?date=hoje` **240s sem responder** e **zero conexões abertas para o NewCorban**, contra 1,0s no dia anterior e 7ms num mês congelado. O gatilho era abundante: 80 re-obtenções de token no log. **Por que só o Digitados parecia quebrado:** ele abre sempre em *hoje*, a chave travada; o Ranking do Mês disfarçava porque as abas de meses fechados vêm de `monthly_rankings` (banco) — o mês corrente estava travado igual. Fix: retry movido para `fetchRankingPeriodo`/`fetchRankingByPayment`, que não consultam o `_inflight`. Ver "Retry de token" na seção de APIs Externas. Coberto por `externalApiRetry.test.js`, que **falha por estouro de prazo** contra a versão anterior |
| Ago/13 | "Ranking Equipe" ainda no menu: era o placar da Copa GD 2026, encerrada em 31/07, e já estava no card arquivado dentro de Campanhas | Página removida do `Shell.jsx` (item do menu, título e mount) e o componente `ShellRanking` apagado — **`ShellRanking.jsx` deixou de ser página** e guarda só o `Telao` e suas views, que o card arquivado importa. Todo mundo passa a entrar por **Campanhas** (antes só o franqueado). Três consequências que não podiam ficar em silêncio: (1) **o botão 📺 Telão vivia só ali** — sem ele, remover a página levaria junto a TV do escritório, então virou `components/TelaoRankings.jsx` e apareceu nas páginas de mês e digitados; (2) o `Telao` era montado com equipes sempre, e a régua de Meta Coletiva mais o ticker mostrariam "0 / —" e uma tira em branco no telão do mês — passaram a depender de `groups.length > 0` (`temEquipes`), o que **não muda o card arquivado**, que tem equipes; (3) a página era montada **sem `ativo`**, então todo usuário logado mantinha um `EventSource` aberto e chamava `/groups/ranking` + os dois rankings a cada 5 min olhando outra tela — isso acabou junto. Ficaram órfãos e **não foram apagados**: `components/MembersModal.jsx` (breakdown de pontos por membro, sem nenhum importador agora) e o modo `today`/`TelaoTodayView` do telão, que já estava morto antes porque ninguém buscava `todayActivity` |
