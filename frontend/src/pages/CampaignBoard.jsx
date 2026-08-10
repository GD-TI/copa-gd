/*
  THESIS — Um quadro de informação pública, não um dashboard. Recusa o pódio 3D
  com blocos 1/2/3 que o painel nativo já entrega, e recusa a estética de
  gamificação (medalha, confete, troféu) da campanha anterior.
  OWN-WORLD — Linhagem Otl Aicher rendida em tela: fundo #0B0D10, tinta branca,
  régua de 1px, posição dentro de um bloco de cor sólida da família de Munique,
  Archivo em numerais tabulares. Raio zero e nenhuma sombra em nenhum estado.
  Escuro porque a cena é uma TV ligada o dia todo numa sala iluminada, não papel.
  STORY — Quem passa na frente da TV lê, em dois segundos, quem está na frente e
  quantas vendas faltam para a própria próxima faixa.
  FIRST VIEWPORT — Faixa de identificação com nome da campanha, data e relógio;
  barra da cor da campanha; lista de linhas altas com posição, nome íntegro,
  contagem e "faltam N"; rodapé com totais do time.
  FORM — Quadro de estação: ultrapassagem é troca de linha cronometrada.
  Direção sorteada, candidata 5. Seed 41949bb7.
*/

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client'
import { API_BASE } from '../api/config'
import '../system.css'

const TARGET_ROWS = 10     // densidade próxima à do placar da Copa
const ROW_MIN = 56         // piso de legibilidade a 4 metros
const ROW_MAX = 120
const PAGE_MS = 14000      // rotação quando não cabe todo mundo
const POLL_MS = 60000

/** Toda a escala tipográfica deriva da altura da linha, então a TV maior
 *  ganha letra maior em vez de mais linhas espremidas. */
function scaleFor(rowH) {
  return {
    '--pos-box':    `${Math.round(rowH * 0.60)}px`,
    '--pos-size':   `${Math.round(rowH * 0.32)}px`,
    '--name-size':  `${Math.round(rowH * 0.36)}px`,
    '--count-size': `${Math.round(rowH * 0.52)}px`,
    '--gap-size':   `${Math.round(rowH * 0.40)}px`,
  }
}

const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Uma linha do quadro. Posicionada por transform para que a troca seja mecânica. */
function Row({ item, top, height, metricLabel }) {
  const reached = item.missing === 0 || item.missing === null
  return (
    <div className="row" data-rank={item.position} style={{ transform: `translateY(${top}px)`, height }}>
      <div className="row-bar" />
      <div className="row-id">
        <span className="row-pos">{item.position}</span>
        <span className="row-name">
          {item.vendor_name}
          {item.team ? <span className="row-team">{item.team}</span> : null}
        </span>
      </div>
      <div className="row-metric">
        <span className="row-count">{item.contracts}</span>
        <span className="row-unit">{metricLabel}</span>
      </div>
      <div className={`row-gap${reached ? ' is-reached' : ''}`}>
        {item.missing === null ? (
          <>
            <span className="row-gap-value">—</span>
            <span className="row-gap-label">sem próxima faixa</span>
          </>
        ) : (
          <>
            <span className="row-gap-value">{item.missing}</span>
            <span className="row-gap-label">
              {item.missing === 1 ? 'falta p/ ' : 'faltam p/ '}
              {fmtBRL(item.next_prize)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export default function CampaignBoard({ campaignId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(TARGET_ROWS)
  const [rowH, setRowH] = useState(ROW_MIN)
  const listRef = useRef(null)
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

  // Atualização periódica + SSE quando o backend avisa que houve mudança
  useEffect(() => {
    const timer = setInterval(load, POLL_MS)
    let es
    try {
      es = new EventSource(`${API_BASE}/api/events/stream`)
      es.addEventListener('scores_updated', load)
    } catch { /* SSE indisponível: o intervalo cobre */ }
    return () => { clearInterval(timer); es?.close() }
  }, [load])

  // A linha se dimensiona pela altura real da tela — a TV maior ganha letra maior,
  // não mais linhas espremidas.
  useEffect(() => {
    const measure = () => {
      const h = listRef.current?.clientHeight || 0
      if (!h) return
      const rh = Math.min(ROW_MAX, Math.max(ROW_MIN, Math.floor(h / TARGET_ROWS)))
      setRowH(rh)
      setRowsPerPage(Math.max(1, Math.floor(h / rh)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [data, loading, error])

  const board = data?.board || []
  const pages = Math.max(1, Math.ceil(board.length / rowsPerPage))

  useEffect(() => {
    if (pages <= 1) { setPage(0); return }
    const t = setInterval(() => setPage(p => (p + 1) % pages), PAGE_MS)
    return () => clearInterval(t)
  }, [pages])

  // Tela cheia ao abrir — o telão é feito para ficar ligado sem ninguém mexer.
  // Alguns navegadores exigem gesto do usuário; o botão cobre esse caso.
  const [isFull, setIsFull] = useState(false)
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
  const start = page * rowsPerPage
  const visible = board.slice(start, start + rowsPerPage)
  const metricLabel = campaign?.metric === 'valor' ? 'em valor' : 'recuperações'

  const dateLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : ''

  return (
    <div className="board" data-color={campaign?.color || 'azul'} style={scaleFor(rowH)}>
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
          {/* Distingue "ninguém vendeu" de "o filtro está apertado demais" —
              no dia da campanha, essa linha evita horas de dúvida. */}
          {data?.diagnostics?.paid_today > 0 ? (
            <p style={{ fontSize: '1.6vh' }}>
              {data.diagnostics.paid_today} contrato(s) pago(s) hoje não entraram:{' '}
              {data.diagnostics.paid_but_registered_another_day > 0
                ? `${data.diagnostics.paid_but_registered_another_day} digitado(s) em outro dia`
                : null}
              {data.diagnostics.paid_but_registered_another_day > 0 && data.diagnostics.other_product > 0 ? ' · ' : null}
              {data.diagnostics.other_product > 0 ? `${data.diagnostics.other_product} de outro produto` : null}
              {data.diagnostics.excluded_non_human > 0 ? ` · ${data.diagnostics.excluded_non_human} da IA` : null}
            </p>
          ) : null}
          {campaign?.ladder?.length ? (
            <div className="board-ladder">
              {campaign.ladder.map(t => (
                <div className="board-ladder-step" key={t.at}>
                  <span className="board-ladder-at">{t.at}</span>
                  <span className="board-ladder-prize">
                    +{fmtBRL(t.prize)}{campaign.spin_every ? ' · giro' : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="board-list" ref={listRef}>
          {visible.map((item, i) => (
            <Row
              key={item.vendor_id}
              item={item}
              top={i * rowH}
              height={rowH}
              metricLabel={metricLabel}
            />
          ))}
        </div>
      )}

      <div className="board-foot">
        <div className="board-totals">
          <span><b>{data?.totals?.contracts ?? 0}</b> recuperações</span>
          <span><b>{fmtBRL(data?.totals?.value)}</b> recuperados</span>
          <span><b>{data?.totals?.participants ?? 0}</b> consultores</span>
        </div>
        {pages > 1 ? (
          <span className="board-page">página {page + 1} de {pages}</span>
        ) : null}
      </div>

      <div className="board-ctl">
        <button onClick={toggleFull}>
          {isFull ? 'Sair da tela cheia · F' : 'Tela cheia · F'}
        </button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>
  )
}
