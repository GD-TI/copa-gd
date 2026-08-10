/*
  THESIS — Um quadro de informação pública, não um dashboard. Herda do telão da
  Copa a estrutura que já funcionava — coluna única de linhas compactas — e
  recusa o pódio 3D do painel nativo e a estética de gamificação.
  OWN-WORLD — Fundo #0B0D10, tinta branca, régua de 1px, barra de cor sólida da
  família de Munique marcando os três primeiros, Archivo em numerais tabulares.
  Raio zero e nenhuma sombra em nenhum estado.
  STORY — Em dois segundos: quem lidera, quanto cada um tem, e quanto falta para
  a próxima faixa de prêmio.
  FIRST VIEWPORT — Faixa de identificação, cabeçalho de colunas, e a lista
  inteira em rolagem lenta; rodapé com totais e premiação.
  FORM — Quadro de estação: a lista corre sozinha, sem virar página.
  Direção sorteada, candidata 5. Seed 41949bb7.
*/

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client'
import { API_BASE } from '../api/config'
import '../system.css'

const POLL_MS = 60000
const SCROLL_STEP_MS = 4200   // pausa em cada trecho antes de correr
const COLS = 'clamp(1.8rem,3.6vh,3rem) clamp(1.5rem,3.4vh,2.5rem) minmax(0,1fr) auto clamp(7rem,14vw,16rem) auto'

/**
 * Os nomes no NewCorban vêm com prefixo de equipe ("MOTIVACAO - JULIA KEI").
 * A campanha é individual e o prefixo empurra o nome da pessoa para o meio da
 * linha. Só corta quando o prefixo é curto e sobra nome de verdade, para não
 * mutilar um nome que legitimamente contenha " - ".
 */
function nomeLimpo(nome = '') {
  const partes = String(nome).split(' - ')
  if (partes.length < 2) return nome
  const prefixo = partes[0].trim()
  const resto = partes.slice(1).join(' - ').trim()
  return prefixo.split(/\s+/).length <= 2 && resto.split(/\s+/).length >= 2 ? resto : nome
}

function iniciais(nome = '') {
  const p = nomeLimpo(nome).trim().split(/\s+/)
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : nome.slice(0, 2)).toUpperCase()
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  return now
}

function Row({ item, tierStart }) {
  const alvo = item.next_at ?? item.contracts
  const base = tierStart ?? 0
  const frac = alvo > base ? Math.min(1, (item.contracts - base) / (alvo - base)) : 1
  const ganhou = Number(item.spins) > 0

  return (
    <div className="row" data-rank={item.position}>
      <span className="row-pos">{item.position}</span>
      <span className="row-av">{iniciais(item.vendor_name)}</span>
      <span className="row-name">{nomeLimpo(item.vendor_name)}</span>
      <span className="row-metric">
        <span className="row-count">{item.contracts}</span>
        <span className="row-unit">recup.</span>
      </span>
      <span className="row-prog">
        <span className="row-bar"><span style={{ '--p': frac }} /></span>
        <span className="row-gap">
          {item.missing === null
            ? 'sem próxima faixa'
            : item.missing === 1
              ? <><b>falta 1</b> para a próxima</>
              : <>faltam <b>{item.missing}</b> para a próxima</>}
        </span>
      </span>
      <span className={`row-pill${ganhou ? ' is-won' : ''}`}>
        {item.spins > 0 ? `${item.spins} giro${item.spins > 1 ? 's' : ''}` : '—'}
      </span>
    </div>
  )
}

export default function CampaignBoard({ campaignId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isFull, setIsFull] = useState(false)
  const [offset, setOffset] = useState(0)
  const viewRef = useRef(null)
  const trackRef = useRef(null)
  const now = useClock()

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/campaigns/${campaignId}/board`)
      setData(data)
      setError(null)
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível carregar o placar')
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    let es
    try {
      es = new EventSource(`${API_BASE}/api/events/stream`)
      es.addEventListener('scores_updated', load)
    } catch { /* SSE indisponível: o intervalo cobre */ }
    return () => { clearInterval(timer); es?.close() }
  }, [load])

  // Rolagem lenta de ida e volta: todo mundo aparece sem virar página
  useEffect(() => {
    const t = setInterval(() => {
      const view = viewRef.current, track = trackRef.current
      if (!view || !track) return
      const excedente = track.scrollHeight - view.clientHeight
      if (excedente <= 8) { setOffset(0); return }
      setOffset(prev => {
        const passo = view.clientHeight * 0.8
        const proximo = prev + passo
        return proximo >= excedente + passo * 0.5 ? 0 : Math.min(proximo, excedente)
      })
    }, SCROLL_STEP_MS)
    return () => clearInterval(t)
  }, [data])

  // Tela cheia ao abrir — o telão fica ligado sem ninguém mexer
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {})
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose?.()
      if (e.key === 'f' || e.key === 'F') toggleFull()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, toggleFull])

  const campaign = data?.campaign
  const board = data?.board || []
  const ladder = Array.isArray(campaign?.ladder) ? [...campaign.ladder].sort((a, b) => a.at - b.at) : []

  // Início da faixa atual, para a barra medir o trecho certo e não o total
  const tierStartOf = item => {
    const anteriores = ladder.filter(t => t.at <= item.contracts).map(t => t.at)
    return anteriores.length ? Math.max(...anteriores) : 0
  }

  const totalGiros = board.reduce((s, v) => s + Number(v.spins || 0), 0)

  const dateLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : ''

  const estilo = { '--cols': COLS, '--row-h': 'clamp(2.6rem, 6.4vh, 4.75rem)' }

  return (
    <div className="board" data-color={campaign?.color || 'azul'} style={estilo}>
      <div>
        <div className="board-head">
          <div>
            <h1 className="board-title">{campaign?.name || 'Ranking GD'}</h1>
            {campaign?.subtitle ? <p className="board-sub">{campaign.subtitle}</p> : null}
          </div>
          <div className="board-meta">
            <span>{dateLabel}</span>
            <span className="board-clock">
              {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <div className="board-stripe" />
      </div>

      {loading ? (
        <div className="board-state"><h2>Carregando o placar…</h2></div>
      ) : error ? (
        <div className="board-state">
          <h2>Placar indisponível</h2>
          <p>{error} — a tela volta sozinha assim que a conexão com o NewCorban se restabelecer.</p>
        </div>
      ) : board.length === 0 ? (
        <div className="board-state">
          <h2>Ninguém pontuou ainda</h2>
          <p>
            A primeira venda recuperada do dia abre o placar. Vale contrato de
            Crédito do Trabalhador digitado e pago hoje.
          </p>
          {/* Distingue "ninguém vendeu" de "o filtro está apertado demais" */}
          {data?.diagnostics?.paid_today > 0 ? (
            <p>
              {data.diagnostics.paid_today} contrato(s) pago(s) hoje não entraram:{' '}
              {[
                data.diagnostics.paid_but_registered_another_day > 0 && `${data.diagnostics.paid_but_registered_another_day} digitado(s) em outro dia`,
                data.diagnostics.other_product > 0 && `${data.diagnostics.other_product} de outro produto`,
                data.diagnostics.other_franquia > 0 && `${data.diagnostics.other_franquia} de fora da matriz`,
                data.diagnostics.excluded_non_human > 0 && `${data.diagnostics.excluded_non_human} da IA`,
              ].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {ladder.length ? (
            <div className="board-ladder">
              {ladder.map(t => (
                <div className="board-ladder-step" key={t.at}>
                  <span className="board-ladder-at">{t.at}</span>
                  <span className="board-ladder-prize">
                    recuperações{campaign.spin_every ? ' · 1 giro' : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="board-list" ref={viewRef}>
          <div className="board-cols">
            <span>#</span><span /><span>Consultor</span><span>Recuperações</span>
            <span>Próxima faixa</span><span>Giros</span>
          </div>
          <div className="board-track" ref={trackRef} style={{ transform: `translateY(${-offset}px)` }}>
            {board.map(item => (
              <Row key={item.vendor_id} item={item} tierStart={tierStartOf(item)} />
            ))}
          </div>
        </div>
      )}

      <div className="board-foot">
        <div className="board-totals">
          <span><b>{data?.totals?.contracts ?? 0}</b> recuperações</span>
          <span className="is-prize"><b>{totalGiros}</b> giros conquistados</span>
          <span><b>{board.length}</b> consultores</span>
        </div>
        <span>atualiza sozinho</span>
      </div>

      <div className="board-ctl">
        <button onClick={toggleFull}>{isFull ? 'Sair da tela cheia · F' : 'Tela cheia · F'}</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>
  )
}
