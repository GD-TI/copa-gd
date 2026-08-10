/*
  THESIS — Modo TV no idioma do protótipo "Sales Arena" que o cliente fixou como
  referência: barra escura no topo com KPIs, progresso coletivo, painel de
  campanha à esquerda e ranking rolando em ticker contínuo à direita.
  OWN-WORLD — Fundo claro em gradiente de marca (verde → roxo → azul), cartões
  brancos com raio 12 e sombra suave, borda esquerda em ouro/prata/bronze nos
  três primeiros, tipografia Outfit.
  STORY — Em dois segundos: quem lidera, quanto cada um tem e quanto falta para
  o próximo giro.
  FIRST VIEWPORT — Topbar com AO VIVO e KPIs; barra de progresso do time; à
  esquerda a campanha e a Escada do Resgate; à direita as linhas do ranking.
  FORM — Ticker vertical contínuo: ninguém espera página virar para se ver.
*/

import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api/client'
import { API_BASE } from '../api/config'
import '../system.css'

const POLL_MS = 60000
const SEG_POR_LINHA = 3.2   // segundos por linha na rolagem contínua

/**
 * Os nomes no NewCorban vêm com prefixo de equipe ("MOTIVACAO - JULIA KEI").
 * A campanha é individual e o prefixo empurra o nome para o meio da linha.
 * Só corta quando o prefixo é curto e sobra nome de verdade.
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

function Linha({ item, tierStart }) {
  const alvo = item.next_at ?? item.contracts
  const base = tierStart ?? 0
  const frac = alvo > base ? Math.min(1, (item.contracts - base) / (alvo - base)) : 1
  const cls = item.position <= 3 ? ` r${item.position}` : ''

  return (
    <div className={`tv-row${cls}`}>
      <div className="tv-rpos">{item.position}</div>
      <div className="tv-rav">{iniciais(item.vendor_name)}</div>
      <div className="tv-rinfo">
        <div className="tv-rname">{nomeLimpo(item.vendor_name)}</div>
        <div className="tv-rrole">
          {item.missing === null
            ? 'no topo da escada'
            : <>falta{item.missing === 1 ? '' : 'm'} <b>{item.missing}</b> para o próximo giro</>}
        </div>
      </div>
      <div className="tv-rpbar">
        <div className="tv-rptrack">
          <div className="tv-rpfill" style={{ transform: `scaleX(${frac})` }} />
        </div>
      </div>
      <div className="tv-rsold">
        {item.contracts}
        <small>recup.</small>
      </div>
      <div className={`tv-rpct${item.spins > 0 ? ' has-spins' : ''}`}>
        {item.spins > 0 ? `${item.spins} giro${item.spins > 1 ? 's' : ''}` : '—'}
      </div>
    </div>
  )
}

// fullscreen: só quando a intenção é a TV. Abrir para conferir não deve
// sequestrar a tela — a pessoa quer olhar e voltar ao que estava fazendo.
export default function CampaignBoard({ campaignId, onClose, fullscreen = false }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isFull, setIsFull] = useState(false)
  const [tick, setTick] = useState({ dist: 0, dur: 0 })
  const wrapRef = useRef(null)
  const rowsRef = useRef(null)
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

  // Ticker só quando a lista não cabe — senão a tela ficaria se mexendo à toa.
  // Mede a altura de UMA volta pelos n primeiros filhos, e não por scrollHeight/2:
  // a cópia usada para emendar o loop só existe depois que o ticker liga, então
  // dividir por 2 antes disso dava metade do valor e o ticker nunca começava.
  useEffect(() => {
    const medir = () => {
      const wrap = wrapRef.current, rows = rowsRef.current
      const n = (data?.board || []).length
      if (!wrap || !rows || !n) return setTick({ dist: 0, dur: 0 })

      const filhos = [...rows.children]
      if (!filhos.length) return
      const ultimo = filhos[Math.min(n, filhos.length) - 1]
      const gap = parseFloat(getComputedStyle(rows).rowGap) || 0
      const umaVolta = ultimo.offsetTop + ultimo.offsetHeight - filhos[0].offsetTop + gap

      if (umaVolta - wrap.clientHeight > 12) {
        setTick({ dist: -umaVolta, dur: Math.max(15, Math.round(n * SEG_POR_LINHA)) })
      } else {
        setTick({ dist: 0, dur: 0 })
      }
    }
    const t = setTimeout(medir, 120)
    window.addEventListener('resize', medir)
    return () => { clearTimeout(t); window.removeEventListener('resize', medir) }
  }, [data])

  useEffect(() => {
    if (fullscreen) document.documentElement.requestFullscreen?.().catch(() => {})
    const onChange = () => setIsFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [fullscreen])

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

  const tierStartOf = item => {
    const anteriores = ladder.filter(t => t.at <= item.contracts).map(t => t.at)
    return anteriores.length ? Math.max(...anteriores) : 0
  }

  const totalGiros = board.reduce((s, v) => s + Number(v.spins || 0), 0)
  const comGiro = board.filter(v => Number(v.spins) > 0).length
  const pctTime = board.length ? (comGiro / board.length) : 0

  const dataLabel = data?.date
    ? new Date(`${data.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    : ''

  const vazio = !loading && !error && board.length === 0

  return (
    <div className="board">
      <div className="tv-topbar">
        {/* Voltar só fora da tela cheia: no telão a tela precisa ficar limpa */}
        {!isFull ? (
          <button className="tv-back" onClick={onClose} title="Voltar para a lista de campanhas">
            ← Voltar
          </button>
        ) : null}
        <span className="tv-live-badge">
          <span className="tv-live-dot" />
          <span className="tv-live-txt">Ao vivo</span>
        </span>
        <span className="tv-tb-name">{campaign?.name || 'Ranking GD'}</span>
        <span className="tv-tb-period">
          {dataLabel} · {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="tv-kpis">
          <div className="tv-kpi">
            <div className="tv-kv grn">{data?.totals?.contracts ?? 0}</div>
            <div className="tv-kl">Recuperações</div>
          </div>
          <div className="tv-kpi">
            <div className="tv-kv prp">{totalGiros}</div>
            <div className="tv-kl">Giros</div>
          </div>
          <div className="tv-kpi">
            <div className="tv-kv wht">{board.length}</div>
            <div className="tv-kl">Consultores</div>
          </div>
        </div>
      </div>

      <div className="tv-prog-row">
        <span className="tv-prog-lbl">Time na roleta</span>
        <div className="tv-prog-track">
          <div className="tv-prog-fill" style={{ transform: `scaleX(${pctTime})` }} />
        </div>
        <span className="tv-prog-pct">{comGiro}/{board.length || 0}</span>
      </div>

      {loading ? (
        <div className="tv-state"><h2>Carregando o placar…</h2></div>
      ) : error ? (
        <div className="tv-state">
          <h2>Placar indisponível</h2>
          <p>{error} — a tela volta sozinha assim que a conexão com o NewCorban se restabelecer.</p>
        </div>
      ) : vazio ? (
        <div className="tv-state">
          <h2>Ninguém pontuou ainda</h2>
          <p>
            A primeira venda recuperada do dia abre o placar. Vale contrato de
            Crédito do Trabalhador digitado e pago hoje, na matriz.
          </p>
          {data?.diagnostics?.paid_today > 0 ? (
            <p>
              {data.diagnostics.paid_today} contrato(s) pago(s) hoje não entraram:{' '}
              {[
                data.diagnostics.paid_but_registered_another_day > 0 && `${data.diagnostics.paid_but_registered_another_day} digitado(s) em outro dia`,
                data.diagnostics.other_product > 0 && `${data.diagnostics.other_product} de outro produto`,
                data.diagnostics.other_franquia > 0 && `${data.diagnostics.other_franquia} de franquia`,
                data.diagnostics.excluded_non_human > 0 && `${data.diagnostics.excluded_non_human} da IA`,
              ].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="tv-body">
          <aside className="tv-left">
            <div className="tv-left-header">
              <div className="tv-left-lbl"><span className="tv-left-lbl-dot" />Campanha do dia</div>
              <div className="tv-left-camp">{campaign?.name}</div>
              {campaign?.subtitle ? <div className="tv-left-prize">{campaign.subtitle}</div> : null}
            </div>

            <div className="tv-right-lbl">Escada do Resgate · recuperações</div>
            <div className="tv-ladder">
              {ladder.map((t, i) => {
                const quantos = board.filter(v => v.contracts >= t.at).length
                return (
                  <div className={`tv-step${quantos > 0 ? ' is-done' : ''}`} key={t.at}>
                    <div className="tv-step-at">{t.at}</div>
                    <div>
                      <div className="tv-step-txt">{i + 1}º giro</div>
                      <div className="tv-step-sub">
                        {quantos === 0 ? 'ninguém ainda'
                          : quantos === 1 ? '1 já chegou'
                          : `${quantos} já chegaram`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          <section className="tv-right">
            <div className="tv-right-lbl">Ranking · {board.length} consultores</div>
            <div className="tv-rows-wrap" ref={wrapRef}>
              <div
                className={`tv-rows${tick.dur ? ' ticking' : ''}`}
                ref={rowsRef}
                style={{ '--tick-dist': `${tick.dist}px`, '--tick-dur': `${tick.dur}s` }}
              >
                {board.map(item => (
                  <Linha key={item.vendor_id} item={item} tierStart={tierStartOf(item)} />
                ))}
                {/* Cópia para o ticker emendar sem salto visível */}
                {tick.dur ? board.map(item => (
                  <Linha key={`d-${item.vendor_id}`} item={item} tierStart={tierStartOf(item)} />
                )) : null}
              </div>
            </div>
          </section>
        </div>
      )}

      <div className="tv-foot">
        <span>Vale contrato de <b>Crédito do Trabalhador</b> digitado e pago hoje, na matriz</span>
        <span>Atualiza sozinho</span>
      </div>

      <div className="board-ctl">
        <button onClick={toggleFull}>{isFull ? 'Sair da tela cheia' : 'Tela cheia · F'}</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>
  )
}
