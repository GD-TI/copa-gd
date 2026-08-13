# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Consultores de crédito do Grupo Digital SF** (vendedores). Trabalham no escritório, com a TV do ambiente ligada durante o expediente. O trabalho deles é fechar contratos; o ranking é o placar que diz onde cada um está em relação aos colegas e à própria meta.

**Gestores / administradores.** Definem campanhas, período, premiação e quem aparece no placar. Precisam consultar campanhas encerradas para apurar vencedores.

Audiência primária confirmada para efeito de design: **quem olha a TV do escritório**, não quem opera o painel.

## Product Purpose

Ranking comercial do Grupo Digital SF, alimentado pelos dados do NewCorban.

Duas camadas confirmadas:

1. **Ranking contínuo** — sempre ligado, sem data de fim. É o placar permanente da operação.
2. **Campanhas** — eventos opcionais com início, fim e premiação própria, sobrepostos ao ranking contínuo. O admin cria, acompanha e consulta o histórico de campanhas encerradas.

Sucesso = a TV do escritório mostra, o tempo todo e sem ninguém mexer, uma disputa que os consultores acompanham e que os faz querer subir de posição.

## Positioning

O NewCorban já possui uma tela de ranking nativa. Este produto existe por três razões que o nativo não cobre, confirmadas pelo cliente:

1. **Campanhas com início, fim e premiação**, com histórico de vencedores preservado — o nativo mostra apenas o período corrente, cru.
2. **Telão de escritório** — uma tela projetada para ser vista de longe, o dia inteiro, sem interação.
3. **Acesso do próprio consultor** — o vendedor vê sua posição, meta e evolução sem precisar de acesso ao painel do NewCorban.

## Operating Context

- **Contexto de exibição dominante:** TV do escritório, vista a 3–5 metros, sem cursor, sem cliques, ligada o dia todo. Isso impõe tipografia de leitura à distância, alto contraste, rotação/rolagem automática de conteúdo e atualização sem intervenção.
- **Contextos secundários:** consultor consultando a própria posição; gestor operando o painel administrativo.
- **Fonte de dados:** APIs do NewCorban (subdomínio `grupodigital`). Não há entrada manual de vendas.
- **Atualização:** o app já opera com SSE (`/api/events/stream`) e cron; a tela precisa refletir mudanças sem recarregar.
- **Campanha anterior:** "Copa GD 2026", disputada por 12 equipes de até 5 pessoas entre 17/06/2026 e 31/07/2026, encerrada. Rodou sobre um motor de pontos por regras.

## Capabilities and Constraints

### Modelo de disputa confirmado (nova fase)

- O ranking é **individual, por consultor** — não por equipe.
- A posição é definida por **métricas diretas vindas do NewCorban**, não por pontos calculados por regras.
- Participantes: **todos os vendedores que aparecem no NewCorban, exceto contas não-humanas** (bots, integrações de API, IA). Ex.: o registro "API (Matriz)", hoje 1º colocado no painel nativo, deve ser excluído.

### Métricas disponíveis nas APIs (verificado no código)

Vindas de `ranking.php?action=performance`, por vendedor:

| Métrica | Campo | Situação |
|---|---|---|
| Quantidade de propostas | `qtd_propostas` | disponível |
| Meta | `valor_meta` | disponível — vem do próprio NewCorban, não precisa cadastro manual |
| Valor financiado | `valor_financiado` | disponível |
| Valor de referência | `valor_referencia` | disponível |
| % de atingimento | derivado | já calculado em `routes/scores.js` |
| **Valor liberado** | `valor_liberado` (presumido) | **NÃO CONFIRMADO** — não há leitura em lugar nenhum do repositório. O painel nativo exibe. Exige verificação contra a API real antes de ser prometido na UI |
| Avatar / foto | — | o ranking **não** retorna imagem. Vem da API v2 `/users` → `avatar_url`, e só existe para quem foi cadastrado no app |
| Nome do vendedor | chave do objeto `result` | disponível |

### Restrições técnicas confirmadas

- **Filtro de produto fixo:** `produto: ['7','13']` está hardcoded em `services/externalApi.js`. Enquanto existir, os números **não batem** com o painel nativo se este considerar todos os produtos. Precisa virar parâmetro — decisão de produto pendente sobre quais produtos contam.
- **Tipo de data:** só o caminho `pagamento` é confiável. O caminho de cadastro carrega um typo histórico (`"cadasto"`) e nunca foi validado para períodos históricos.
- **Stack:** Node/Express + React/Vite + PostgreSQL, servidos como app único. Deploy em VPS atrás de nginx, domínio `copa.grupodigitalsf.com.br`.
- **Autenticação:** o consultor entra com o mesmo login do NewCorban. Papéis existentes: `admin`, `team_admin`, `player`.

### Decisões confirmadas

- **Nome da plataforma: "Ranking GD".** "Copa GD 2026" passa a ser o nome da campanha encerrada dentro do arquivo, não do produto.
- **Produto contado: CLT.** Permanece o mesmo recorte de produto que a operação já usa. O filtro fixo em `externalApi.js` corresponde a esse recorte e não deve ser removido — deve ser explicitado e nomeado no código.

### Regra de negócio nova, ainda em definição pelo cliente

**"Contar o pago que foi digitado no mesmo dia."** A nova campanha precisa considerar contratos cujo **cadastro e pagamento ocorrem na mesma data**. Isso não é uma métrica que a plataforma calcula hoje.

Viabilidade verificada: a API v3 de propostas retorna `dates.created_at` e `dates.payment_date` no mesmo registro, então a comparação é possível sem endpoint novo. O que falta é a decisão do cliente sobre **como** a regra entra:

- como **filtro** do ranking (só contratos pago-no-mesmo-dia entram no valor); ou
- como **métrica adicional** exibida ao lado das demais; ou
- como **critério de desempate**.

O cliente declarou que ainda está avaliando. Não implementar uma interpretação sem confirmar.

### Fatos de produto ainda em aberto

- **O que exatamente "premiação" registra** — texto livre, valor, ou lista de prêmios por colocação.

**~~Se o ranking contínuo é mensal, trimestral ou móvel.~~ RESPONDIDO em 12/08/2026: mensal.** O cliente definiu: ranking do mês por contratos **pagos**, ordenado por R$, zerando na virada do mês; e um segundo ranking de contratos **digitados**, zerando todo dia. Escopo é a empresa inteira (matriz e franquias), sem robôs. Mês encerrado congela e não muda mais. Implementado — ver "Ranking Individual" no [`CLAUDE.md`](CLAUDE.md).

## Brand Commitments

- **Grupo Digital SF** é a empresa. O rodapé atual assina "Grupo Digital SF".
- **Logo existente:** marca "GD" em SVG, dois traços curvos, embutida em `frontend/src/components/Shell.jsx`. É um ativo real e reutilizável.
- **A identidade "Copa / futebol" está encerrada** — o cliente confirmou a virada de tema. Verde-amarelo-azul da bandeira, campo de futebol, bola, torcida, artilheiro e gol de placa saem da plataforma.
- **Exceção deliberada:** a campanha "Copa GD 2026" continua consultável **com a aparência que tinha**. O tema futebolístico sobrevive ali dentro, como registro histórico, não como identidade da plataforma.

## Evidence on Hand

- **Dados reais em produção**, acessíveis hoje: `GET /api/groups/ranking` retorna as 12 equipes da Copa com pontuação final (Holanda 875, Bélgica 835, Colômbia 715…); `GET /api/settings/campaign` retorna a campanha encerrada.
- **`GET /api/rankings/mensal`** e **`GET /api/rankings/digitados`** devolvem a lista completa de consultores da empresa com `contratos`, `valor`, `valor_meta`, `atingimento`, `equipe`, `franquia_nome` e a **foto de perfil** do CDN do NewCorban. Fonte é o `ranking.php` — uma requisição, ~1,8 s para a empresa inteira. (O antigo `GET /api/scores/individual-rankings` virou legado em 12/08/2026: só serve o arquivamento da Copa.)
- **Referência visual do cliente:** o painel nativo do NewCorban em `grupodigital.newcorban.com.br/?p=ranking` — pódio 3D com avatares, lista com Propostas / Meta / Financiado / Liberado / Referência, alternadores por métrica, modo tela cheia, rolagem automática com controle de velocidade.
- **Protótipo estático** `copa_gd_painel_.html` na raiz do repositório: painel comercial completo, com dados de demonstração em `localStorage`.
- **Não há** dados de premiação, histórico de vencedores anteriores, nem qualquer campanha além da Copa GD 2026. Não inventar.

## Product Principles

1. **A TV manda.** Toda decisão de layout, tamanho e contraste se resolve pela pergunta "isso é legível a quatro metros?". Densidade e ferramentas ficam com as telas operadas de perto.
2. **O número é o produto.** Valores e posições são o conteúdo; cromo, moldura e ornamento existem só para servi-los.
3. **Sem intervenção.** A tela do escritório precisa sobreviver a um dia inteiro sozinha: atualiza, rotaciona e se recupera de falha de API sem ninguém tocar.
4. **Os dados são do NewCorban.** A plataforma não é fonte de verdade de vendas — ela recorta, cura e dramatiza o que o NewCorban informa. Divergência numérica com o painel nativo é bug.
5. **A campanha é um recorte, não um sistema paralelo.** Criar campanha é definir período, participantes e prêmio sobre o mesmo ranking — não configurar um motor novo.

## Accessibility & Inclusion

Nenhum requisito normativo foi estabelecido pelo cliente. Duas necessidades derivam do contexto de uso confirmado e valem como piso:

- **Leitura à distância** (3–5 m) exige contraste bem acima do mínimo AA e tamanhos de texto muito superiores ao de aplicação comum.
- **Nomes próprios são o conteúdo principal** — não podem ser truncados de forma que o consultor não se reconheça. O painel nativo trunca ("KAIO ALENCAR…"); isso é uma falha a corrigir, não a copiar.
