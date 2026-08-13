import { useState } from 'react'

/**
 * Linhas do ranking individual — as mesmas no telão e nas páginas de consulta.
 *
 * Duas variantes, que diferem só em qual número é o grande:
 *   mensal    → R$ pago no mês (ordem do ranking), contratos e meta no apoio
 *   digitados → contratos digitados no dia, R$ no apoio
 *
 * Estes componentes NÃO substituem `TelaoIndView`/`TelaoTodayView` do
 * `ShellRanking.jsx`: aqueles continuam servindo o snapshot congelado da Copa
 * GD 2026 no card arquivado, que tem outra forma de dado.
 */

const brl = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const brlCurto = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

/**
 * Só palavras que começam com letra entram. Vários cadastros do NewCorban vêm
 * como "MOTIVACAO - JULIA KEI…", e sem este filtro as iniciais saíam "M-".
 */
function iniciais(nome) {
  const partes = String(nome || '')
    .split(/\s+/)
    .filter(p => /^\p{L}/u.test(p))
  if (!partes.length) return '?'
  return partes.slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

/**
 * O `ranking.php` traz a foto de perfil do CDN do NewCorban. Ela pode não
 * carregar (conta sem foto, URL morta), e aí as iniciais entram no lugar — sem
 * isso a coluna ficaria com buracos.
 */
function Avatar({ foto, nome }) {
  const [falhou, setFalhou] = useState(false)
  if (foto && !falhou) {
    return <img className="ri-foto" src={foto} alt="" loading="lazy" onError={() => setFalhou(true)} />
  }
  return <div className="ri-foto ri-iniciais">{iniciais(nome)}</div>
}

function Linha({ item, variante }) {
  const podio = item.position <= 3 ? ` ri-p${item.position}` : ''
  const origem = [item.equipe, item.franquia_nome].filter(Boolean).join(' · ')

  const grande = variante === 'mensal'
    ? `R$ ${brl(item.valor)}`
    : `${item.contratos}`

  // Meta em R$, não o % de atingimento: a meta da NewCorban é derivada do
  // contrato, então o percentual sai sempre entre 200% e 500% e não informa
  // nada. O painel da NC mostra "Meta: R$ …" — aqui é o mesmo número.
  const apoio = variante === 'mensal'
    ? [
        `${item.contratos} contrato${item.contratos === 1 ? '' : 's'}`,
        item.valor_meta > 0 ? `meta R$ ${brl(item.valor_meta)}` : null,
      ].filter(Boolean).join(' · ')
    : `R$ ${brlCurto(item.valor)}`

  return (
    <div className={`ri-linha${podio}`}>
      <div className="ri-pos">{item.position}</div>
      <Avatar foto={item.foto} nome={item.nome} />
      <div className="ri-id">
        <div className="ri-nome">{item.nome}</div>
        {origem && <div className="ri-origem">{origem}</div>}
      </div>
      <div className="ri-nums">
        <div className="ri-grande">
          {grande}
          {variante === 'digitados' && <span className="ri-unidade">digitados</span>}
        </div>
        <div className="ri-apoio">{apoio}</div>
      </div>
    </div>
  )
}

/**
 * Lista que rola sozinha, em loop — escolha do cliente (12/08/2026) para caber
 * a empresa inteira (60+ nomes) numa TV. Quem está em 30º precisa se ver em
 * algum momento; um top 10 fixo esconde mais de 80% da lista.
 *
 * A emenda fica invisível porque a faixa contém a lista **duas vezes** e a
 * animação anda exatamente 50% dela: quando volta ao começo, o que está na tela
 * é idêntico ao que estava um instante antes.
 *
 * Lista curta não rola: com poucos nomes tudo já cabe, e movimento sem motivo
 * só atrapalha a leitura.
 */
function ListaRolante({ itens, variante, rolar, segundosPorLinha = 1.6 }) {
  const anima = rolar && itens.length > 1
  const faixa = anima ? [...itens, ...itens] : itens

  return (
    <div className={`ri-scroll${anima ? ' ri-rola' : ''}`}>
      <div
        className="ri-track"
        style={anima ? { animationDuration: `${itens.length * segundosPorLinha}s` } : undefined}
      >
        {faixa.map((item, i) => (
          <Linha key={`${item.vendedor_id}-${i}`} item={item} variante={variante} />
        ))}
      </div>
    </div>
  )
}

/**
 * Corpo de um dos dois rankings.
 *
 * `rolarAPartirDe` é o número de linhas em que a rolagem passa a valer a pena.
 * Na TV é baixo (a lista é longa e ninguém interage); numa página aberta de
 * perto o padrão é não rolar, porque a pessoa usa a barra de rolagem.
 */
export function RankingLista({ dados, variante, vazio, rolarAPartirDe = Infinity }) {
  const board = dados?.board || []

  if (!dados) return <div className="ri-estado">Carregando…</div>
  if (board.length === 0) return <div className="ri-estado">{vazio}</div>

  return (
    <ListaRolante
      itens={board}
      variante={variante}
      rolar={board.length >= rolarAPartirDe}
    />
  )
}

/** Cabeçalho com os totais da janela — o mesmo formato nos dois rankings. */
export function RankingResumo({ dados, unidade = 'contratos' }) {
  if (!dados?.totals) return null
  const { participantes, contratos, valor } = dados.totals
  return (
    <div className="ri-resumo">
      <span className="ri-resumo-item"><strong>{participantes}</strong> consultores</span>
      <span className="ri-resumo-sep">·</span>
      <span className="ri-resumo-item"><strong>{contratos.toLocaleString('pt-BR')}</strong> {unidade}</span>
      <span className="ri-resumo-sep">·</span>
      <span className="ri-resumo-item"><strong>R$ {brlCurto(valor)}</strong></span>
      {dados.congelado && <span className="ri-selo">🧊 mês fechado</span>}
      {dados.ao_vivo && <span className="ri-selo ri-selo-vivo">ao vivo</span>}
    </div>
  )
}

/** Rótulo "Agosto/2026" a partir de "2026-08". */
export function nomeDoMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return mes || ''
  const [ano, m] = mes.split('-')
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  return `${nomes[Number(m) - 1]}/${ano}`
}

export { brl, brlCurto, iniciais }
