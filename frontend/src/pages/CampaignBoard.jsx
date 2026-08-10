/*
  THESIS — Um quadro de informação pública, não um dashboard. Recusa o pódio 3D
  do painel nativo e a estética de gamificação da campanha anterior. Com 37
  consultores, recusa também a lista paginada: ninguém deve esperar a página
  virar para se encontrar.
  OWN-WORLD — Linhagem Otl Aicher rendida em tela: fundo #0B0D10, tinta branca,
  régua de 1px, posição dentro de um bloco de cor sólida da família de Munique,
  Archivo em numerais tabulares. Raio zero e nenhuma sombra em nenhum estado.
  STORY — Em dois segundos: quem lidera, quem está a um passo de girar, e onde
  eu estou. As três perguntas coexistem na mesma tela.
  FIRST VIEWPORT — Faixa de identificação; à esquerda a disputa (6 primeiros,
  grandes, com trilho de progresso até a próxima faixa); à direita "prestes a
  girar" e o time inteiro; rodapé com totais e premiação acumulada.
  FORM — Quadro de estação: mudança de posição é deslocamento cronometrado.
  Direção sorteada, candidata 5. Seed 41949bb7.
*/

import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { API_BASE } from '../api/config'
import '../system.css'

const LEAD = 6          // quantos entram na zona da disputa
const HOT_MAX = 6       // quantos cabem em "prestes a girar"
const POLL_MS = 60000

const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/**
 * Os nomes no NewCorban vêm com prefixo de equipe ("MOTIVACAO - JULIA KEI").
 * A campanha é individual, e num telão o prefixo empurra o nome da pessoa para
 * o meio da linha. Só corta quando o prefixo é curto e sobra nome de verdade —
 * assim um nome que legitimamente contenha " - " não é mutilado.
 */
function nomeLimpo(nome = '') {
  const m = String(nome).split(' - ')
  if (m.length < 2) return nome
  const prefixo = m[0].trim()
  const resto = m.slice(1).join(' - ').trim()
  const prefixoCurto = prefixo.split(/\s+/).length <= 2
  const restoTemNome = resto.split(/\s+/).length >= 2
  return prefixoCurto && restoTemNome ? resto : nome
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  return now
}

function LeadRow({ item, tierStart }) {
  const alvo = item.next_at ?? item.contracts
  const base = tierStart ?? 0
  const frac = alvo > base ? Math.min(1, (item.contracts - base) / (alvo - base)) : 1

  return (
    <div className="lead-row" data-rank={item.position}>
      <span className="lead-pos">{item.position}</span>
      <span className="lead-id">
        <span className="lead-name">{nomeLimpo(item.vendor_name)}</span>
        <span className="lead-track"><span style={{ '--p': frac }} /></span>
      </span>
      <span className="lead-metric">
        <span className="lead-count">{item.contracts}</span>
        <span className="lead-unit">recuperações</span>
      </span>
      <span className="lead-gap">
        {item.missing === null ? (
          <>
            <span className="lead-gap-value">—</span>
            <span className="lead-gap-label">sem próxima faixa</span>
          </>
        ) : (
          <>
            <span className="lead-gap-value">{item.missing}</span>
            <span className="lead-gap-label">
              {item.missing === 1 ? 'falta p/ ' : 'faltam p/ '}{fmtBRL(item.next_prize)}
            </span>
          </>
        )}
        {item.prize_value > 0 ? (
          <span className="lead-prize">{fmtBRL(item.prize_value)} garantidos</span>
        ) : null}
      </span>
    </div>
  )
}

export default function CampaignBoard({ campaignId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isFull, setIsFull] = useState(false)
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

  // Início da faixa atual, para o trilho medir o trecho certo e não o total
  const tierStartOf = item => {
    const anteriores = ladder.filter(t => t.at <= item.contracts).map(t => t.at)
    return anteriores.length ? Math.max(...anteriores) : 0
  }

  const lead = board.slice(0, LEAD)
  const resto = board.slice(LEAD)

  // Quem está a 1 ou 2 vendas da próxima faixa — a lista dos boletins
  const quentes = board
    .filter(v => v.missing !== null && v.missing <= 2)
    .sort((a, b) => a.missing - b.missing || b.contracts - a.contracts)
    .slice(0, HOT_MAX)

  const totalPremio = board.reduce((s, v) => s + Number(v.prize_value || 0), 0)
  const totalGiros = board.reduce((s, v) => s + Number(v.spins || 0), 0)

  const dateLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : ''

  return (
    <div className="board" data-color={campaign?.color || 'azul'}>
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

      <div className="board-body">
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
                      +{fmtBRL(t.prize)}{campaign.spin_every ? ' · giro' : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="lead">
              {lead.map(item => (
                <LeadRow key={item.vendor_id} item={item} tierStart={tierStartOf(item)} />
              ))}
            </div>

            <aside className="rail">
              <div className="hot">
                <h2 className="rail-title">Prestes a <b>girar</b></h2>
                {quentes.length ? (
                  <div className="hot-list">
                    {quentes.map(v => (
                      <div className="hot-item" key={v.vendor_id}>
                        <span className="hot-name">{nomeLimpo(v.vendor_name)}</span>
                        <span className="hot-gap">
                          {v.missing === 1 ? 'falta 1' : `faltam ${v.missing}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hot-empty">Ninguém a menos de três vendas da próxima faixa.</p>
                )}
              </div>

              <div className="field">
                <h2 className="rail-title">Time · <b>{board.length}</b> no placar</h2>
                <div className="field-grid">
                  {resto.map(v => (
                    <div className="field-item" key={v.vendor_id} data-close={v.missing !== null && v.missing <= 2}>
                      <span className="field-name">{v.position}. {nomeLimpo(v.vendor_name)}</span>
                      <span className="field-count">{v.contracts}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      <div className="board-foot">
        <div className="board-totals">
          <span><b>{data?.totals?.contracts ?? 0}</b> recuperações</span>
          <span><b>{fmtBRL(data?.totals?.value)}</b> recuperados</span>
          <span className="is-prize"><b>{fmtBRL(totalPremio)}</b> em prêmios</span>
          <span><b>{totalGiros}</b> giros conquistados</span>
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
