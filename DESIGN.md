---
name: Ranking GD
description: Quadro de informação pública para o placar comercial do Grupo Digital SF, legível a quatro metros.
---

<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->

# Design System: Ranking GD

## Overview

**Creative North Star: "O Quadro de Informação Pública"**

Otl Aicher desenhou, para os Jogos de Munique em 1972, o primeiro sistema visual completo de uma competição esportiva: pictogramas, sinalização, placares, tudo governado por uma malha e por uma paleta fechada. O problema que ele resolveu é literalmente o nosso — informação hierárquica de uma disputa, lida de longe, em espaço público, por pessoas que não estão operando nada. É herança esportiva sem um único clichê de futebol, e é a razão desta escolha.

O sistema é chapado, geométrico e ortogonal. Não há cartão flutuante, sombra, gradiente, brilho nem pódio tridimensional. A hierarquia vem de três coisas apenas: **escala**, **cor sólida** e **régua fina**. Um número de posição grande ao lado de um valor maior ainda, separados por uma linha de um pixel, comunicam mais a quatro metros do que qualquer profundidade simulada — e comunicam sem custo de atenção para quem trabalha ao lado da tela o dia inteiro.

A paleta vem de Munique — azul, verde, laranja, violeta e prata — mas rendida sobre **fundo escuro**, não sobre papel. A decisão é da cena de uso, não da referência: a superfície real é uma TV ligada oito horas por dia numa sala iluminada, e não uma folha impressa. Sobre preto a cor de Munique ganha saturação e o brilho da tela para de competir com a luz ambiente. A paleta continua viva sem ser infantil, o que resolve a energia de um salão de vendas sem recorrer a medalha, confete ou troféu. Cada campanha recebe uma cor dessa família, e é assim que o arquivo histórico se organiza: uma parede de cores legível de relance.

**Key Characteristics:**
- Fundo escuro e chapado; a cor sólida e a régua fazem todo o trabalho
- Raio de canto zero em absolutamente tudo
- Nenhuma sombra em nenhum estado
- Numerais tabulares em escala monumental
- Uma cor sólida por campanha, tirada de uma família fechada
- Movimento mecânico e cronometrado, nunca decorativo

## Colors

Uma família fechada de cinco cores saturadas sobre fundo escuro, herdada da identidade de Munique 1972 — onde a ausência deliberada de vermelho e preto puro era uma decisão de projeto, não um acaso. Os valores foram abertos em relação ao original impresso: sobre preto, a cor precisa de mais luminosidade para manter a mesma presença.

### Primary
- **Azul Sinal** (`#1789D8`): a cor institucional do sistema. Estado ativo, foco de campo, e a cor padrão do ranking contínuo. É a única que aparece fora do contexto de uma campanha, e também marca o 2º lugar.

### Secondary
As quatro cores restantes não têm hierarquia entre si — existem para serem **atribuídas a campanhas**, uma por campanha, e para marcar posição.
- **Verde Campo** (`#22A163`): campanha; 3º lugar; meta atingida.
- **Laranja Marca** (`#F26A1B`): campanha — a cor da Missão Resgate.
- **Violeta** (`#7A5CC4`): campanha.
- **Prata** (`#8B9199`): campanha; e a cor neutra de posição fora do pódio.

### Neutral
- **Fundo Quadro** (`#0B0D10`): o ground do telão. Escuro sem ser preto puro.
- **Fundo Rodapé** (`#0F1216`): faixa de totais e superfícies de apoio, separadas do ground por tom, nunca por sombra.
- **Tinta** (`#FFFFFF`): texto primário e numerais sobre o quadro.
- **Tinta Secundária** (`#8A9099`): rótulos, unidades, metadados. Contraste 6,1:1 sobre o fundo do quadro.
- **Régua** (`#22262C`): a linha de 1px que separa registros. O único divisor do sistema.

### Named Rules

**A Regra Sem Vermelho.** Aicher baniu o vermelho e o preto puro de Munique por associação histórica. Aqui a regra sobrevive por motivo funcional: no quadro, queda de posição e valor negativo são marcados em **Prata**, nunca em vermelho. Vermelho existe no sistema em exatamente um lugar — confirmação de ação destrutiva no painel administrativo — e jamais aparece no telão.

**A Regra Uma Cor por Campanha.** Uma campanha escolhe uma cor da família Secondary e a mantém para sempre, inclusive no arquivo. Duas campanhas ativas nunca compartilham cor. A cor identifica a campanha antes do nome dela ser lido.

**A Regra do Fundo Dominante.** O fundo ocupa mais de 70% de qualquer tela. Cor sólida entra na faixa da campanha, no bloco de posição e em estados ativos — nunca como campo de fundo de uma seção inteira.

## Typography

**Display Font:** Archivo (com Helvetica Neue, Arial, sans-serif)
**Body Font:** Public Sans (com system-ui, sans-serif)

Ambas auto-hospedadas em woff2. O telão precisa sobreviver a queda de rede e a firewall corporativo — carregar fonte de CDN é um ponto único de falha inaceitável numa tela que fica ligada o dia todo.

**Character:** Duas grotescas de linhagem neo-suíça, escolhidas por competência e não por expressão. Archivo tem numerais tabulares de peso alto que aguentam escala monumental sem virar caricatura; Public Sans foi desenhada para informação pública de governo — legibilidade acima de personalidade, exatamente o registro deste quadro.

### Hierarchy
- **Display** (Archivo, 700, `clamp(4rem, 9vw, 10rem)`, line-height 0.9, letter-spacing −0.03em, `font-variant-numeric: tabular-nums`): o valor do líder e os numerais de posição no telão. Só numerais.
- **Headline** (Archivo, 600, `clamp(1.75rem, 3.5vw, 3rem)`, line-height 1.05): nome do consultor no telão; título de campanha.
- **Title** (Public Sans, 600, 1.25rem, line-height 1.3): títulos de seção na aplicação operada de perto.
- **Body** (Public Sans, 400, 1rem, line-height 1.55, máximo 68ch): texto corrido, descrições, ajuda.
- **Label** (Public Sans, 600, 0.75rem, letter-spacing 0.12em, caixa alta): rótulos de campo, cabeçalho de coluna, faixa de identificação do quadro.

### Named Rules

**A Regra do Nome Inteiro.** Nome de consultor nunca é truncado com reticências. O painel nativo do NewCorban trunca ("KAIO ALENCAR…") e isso é uma falha a corrigir, não a copiar — a pessoa precisa se reconhecer no placar. Quando o espaço aperta, reduz-se o corpo da fonte ou quebra-se em duas linhas; nunca se corta.

**A Regra Tabular.** Todo numeral que aparece em coluna usa `font-variant-numeric: tabular-nums`. Valores em colunas diferentes precisam alinhar dígito com dígito, sempre.

## Layout

Malha modular rígida de 12 colunas, com medianiz constante e margens iguais. A malha é a autoridade: nada se posiciona por olho, tudo se alinha a módulo.

Escala de espaçamento de base 4, usada sem exceção: **4, 8, 12, 16, 24, 32, 48, 64, 96, 128px**. O sistema incumbente não tem tokens de espaçamento — todo padding é número mágico inline — e essa é a primeira dívida a quitar.

**Duas densidades, não uma.**
- **Densidade Quadro** (telão): a altura da linha é derivada da altura real da tela, mirando **10 registros visíveis**, com piso de 56px e teto de 120px. Toda a escala tipográfica deriva dessa altura (posição 0,32× · nome 0,36× · contagem 0,52× · faixa 0,40×), então uma TV maior ganha letra maior em vez de mais linhas espremidas. Calibrada para 3–5 metros.
- **Densidade Operação** (painel administrativo e consulta): altura de linha de 44px, corpo de 1rem, tabelas roláveis. Calibrada para 60cm.

Nenhuma tela mistura as duas. O telão não ganha um formulário; o painel não ganha tipografia de estádio.

Breakpoints: 640, 900, 1280, 1920px. Acima de 1920 o telão **cresce a tipografia**, não a quantidade de conteúdo — mais pixels significam letras maiores, nunca mais linhas espremidas.

Toda tabela larga vive dentro de um contêiner com `overflow-x: auto`. A tabela de metas atual tem oito colunas dentro de um cartão com `overflow: hidden`, o que corta colunas sem scroll em telas estreitas — bug estrutural que este sistema proíbe por regra.

## Elevation & Depth

**Este sistema não tem sombras.** Nenhuma, em nenhum estado, em nenhum componente. `box-shadow` é proibido fora de um único uso: o anel de foco de acessibilidade.

Profundidade é comunicada por três meios, nesta ordem de preferência:
1. **Régua** — uma linha de 1px em Régua (`#22262C`) separa registros e seções.
2. **Deslocamento tonal** — o rodapé é Fundo Rodapé sobre o Fundo Quadro. Dois tons, não uma sombra.
3. **Bloco de cor sólida** — o quadrado de posição e a faixa da campanha ancoram o elemento sem simular altura.

### Named Rules

**A Regra Plana Absoluta.** Se um elemento parece flutuar, o desenho está errado. O quadro é impresso, não empilhado.

## Shapes

**Raio de canto zero em tudo.** Botão, campo, cartão, avatar, marcador, modal, barra de progresso: todos retangulares. Esta é a decisão de forma mais visível do sistema e a que mais o separa do painel administrativo genérico — e, junto com a ausência de sombra, é o que o torna reconhecível com todo o conteúdo removido.

Bordas são hairlines de 1px em Régua. A faixa da campanha no topo tem altura fixa proporcional à tela (0,8vh, mínimo 5px).

O **bloco de posição** é o elemento de forma mais característico: um quadrado sólido de lado 0,60× a altura da linha, com o numeral centralizado e vazado em branco. Ele carrega a cor da campanha no 1º lugar, Azul no 2º e Verde no 3º; fora do pódio, fica transparente com o numeral em Tinta Secundária. É como Aicher marcava disciplinas — e é o que substitui o pódio tridimensional que esta direção recusa.

Avatar de consultor, quando existir, é **quadrado**, recortado em 1:1. Sem foto — o caso majoritário, já que o avatar só existe para quem foi cadastrado — usam-se as iniciais em Archivo sobre a cor da campanha, no mesmo quadrado. Iniciais são um ativo desenhado, não um estado de falha.

Pictogramas seguem a construção de Aicher: traço único de peso constante, apenas ângulos de 45° e 90°, dentro de uma caixa quadrada. Um conjunto pequeno e autoral cobre ranking, campanha, consultor, meta e arquivo. **Emoji é proibido como ícone** — o sistema incumbente usa 🏆⚽🎉🇧🇷 como linguagem de ícone, e isso sai inteiro.

## Do's and Don'ts

### Do:
- **Do** manter raio de canto em `0` em todos os componentes, sem exceção.
- **Do** comunicar hierarquia por escala, cor sólida e régua de 1px — nessa ordem.
- **Do** usar `font-variant-numeric: tabular-nums` em todo numeral que aparece em coluna.
- **Do** escrever o nome do consultor por inteiro, reduzindo o corpo ou quebrando linha quando faltar espaço.
- **Do** atribuir uma cor da família Secondary a cada campanha e mantê-la no arquivo.
- **Do** usar a escala de espaçamento de base 4 para todo padding, gap e margem.
- **Do** envolver toda tabela larga em `overflow-x: auto`.
- **Do** desligar todo movimento sob `prefers-reduced-motion` — o telão roda 8 horas por dia ao lado de pessoas trabalhando.
- **Do** auto-hospedar as duas famílias tipográficas em woff2.

### Don't:
- **Don't** usar `box-shadow` em lugar nenhum, exceto no anel de foco.
- **Don't** usar gradiente, brilho, vidro fosco, aura pulsante ou partícula de faísca — o sistema incumbente tem todos esses e nenhum sobrevive.
- **Don't** construir pódio tridimensional com blocos 1/2/3; é exatamente a solução que o painel nativo já dá e o rut que esta direção recusa.
- **Don't** usar vermelho no telão, nem para queda de posição nem para valor negativo — use Prata.
- **Don't** clarear o fundo do telão para branco: a decisão de fundo escuro vem da cena de uso (tela ligada o dia todo em sala iluminada), não de preferência estética.
- **Don't** usar emoji como ícone.
- **Don't** truncar nome de pessoa com reticências.
- **Don't** misturar a Densidade Quadro e a Densidade Operação na mesma tela.
- **Don't** adicionar ornamento quando a tela parecer seca: a correção é subir escala e saturação, nunca acrescentar efeito.
- **Don't** escrever estilo inline em tela nova — o sistema incumbente tem 313 blocos `style={{}}` e é a dívida que impede qualquer re-tema.
