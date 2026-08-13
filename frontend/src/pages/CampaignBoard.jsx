/*
  THESIS — Modo TV no idioma do protótipo "Sales Arena" que o cliente fixou como
  referência: barra escura no topo com KPIs, progresso coletivo, painel de
  campanha à esquerda e ranking rolando em ticker contínuo à direita.
  OWN-WORLD — Duas superfícies: à esquerda um palco escuro com os cartões de
  destaque em ouro/prata/bronze (o `.cc` do protótipo `copa_gd_painel_.html`,
  referência fixada pelo cliente) sobre confete; à direita o claro em gradiente
  de marca, com a escada deitada e as linhas do ranking.
  STORY — Em dois segundos: quem lidera, quanto cada um tem e quanto falta para
  o próximo giro.
  FIRST VIEWPORT — Topbar com AO VIVO e KPIs; barra de progresso do time; à
  esquerda campanha e pódio; à direita a Escada do Resgate e o ranking.
  FORM — Ticker vertical contínuo: ninguém espera página virar para se ver.
*/

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import api from '../api/client'
import { API_BASE } from '../api/config'
import { Telao } from './ShellRanking'
import '../system.css'

const POLL_MS = 60000
const SEG_POR_LINHA = 3.2   // segundos por linha na rolagem contínua

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
})

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

/**
 * A escada é cumulativa: quem chegou a 15 também passou por 5 e 10. Isso dá
 * três estados, e só um deles é notícia — a FRONTEIRA, o degrau mais baixo que
 * ninguém alcançou ainda. É onde a sala está empurrando agora, e é a única
 * linha que ganha altura, cor e um nome próprio. Conquistado vira registro
 * (uma linha, com quantos passaram); horizonte recua.
 *
 * `board` chega ordenado por contratos desc, então o primeiro nome abaixo do
 * corte é, por construção, quem está mais perto de abrir o degrau.
 */
function degraus(ladder, board) {
  const linhas = ladder.map((t, i) => ({
    at: t.at,
    ordinal: i + 1,
    chegaram: board.filter(v => v.contracts >= t.at).length,
  }))
  const fronteira = linhas.findIndex(r => r.chegaram === 0)

  return linhas.map((r, i) => ({
    ...r,
    estado: r.chegaram > 0 ? 'done' : i === fronteira ? 'next' : 'ahead',
    maisPerto: i === fronteira ? board.find(v => v.contracts < r.at) || null : null,
  }))
}

/**
 * Medalha em SVG, não emoji.
 *
 * A referência do cliente usa 🥇🥈🥉, mas o glifo de emoji é desenhado pelo
 * sistema operacional: a TV do escritório renderiza o que a fonte dela tiver, e
 * o número da colocação não caberia dentro dele. Aqui a fita e o disco são
 * desenhados por nós e o numeral mora no centro — que é, aliás, o que o CSS
 * `.cc-rb` do protótipo já descrevia ("3D coin with number").
 */
const MEDALHA = {
  1: { disco: ['#FFE566', '#F59E0B', '#D97706', '#92600A'], aro: '#FCD34D', num: '#4A2400', fita: ['#8A4B00', '#C2761A'] },
  2: { disco: ['#F4F6F8', '#C8D0DA', '#9CA3AF', '#6B7280'], aro: '#E5E7EB', num: '#2B3240', fita: ['#3F4753', '#79828F'] },
  3: { disco: ['#FFC98F', '#CD7F32', '#B45309', '#7C2D12'], aro: '#FBBF24', num: '#3A1400', fita: ['#5E2408', '#96431A'] },
}

function Medalha({ rank }) {
  const m = MEDALHA[rank]
  if (!m) return null
  const gid = `medalha-${rank}`

  return (
    <svg className="tv-cc-medal" viewBox="0 0 44 56" role="img" aria-label={`${rank}º lugar`}>
      <defs>
        <radialGradient id={gid} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor={m.disco[0]} />
          <stop offset="45%" stopColor={m.disco[1]} />
          <stop offset="75%" stopColor={m.disco[2]} />
          <stop offset="100%" stopColor={m.disco[3]} />
        </radialGradient>
      </defs>
      {/* fitas: cruzam atrás do disco, a da direita por cima */}
      <path d="M9 0 L20 4 L24 26 L11 26 Z" fill={m.fita[0]} />
      <path d="M35 0 L24 4 L20 26 L33 26 Z" fill={m.fita[1]} />
      <circle cx="22" cy="37" r="17" fill={`url(#${gid})`} stroke={m.aro} strokeWidth="2.5" />
      <text className="tv-cc-medal-n" x="22" y="37.5" fill={m.num}
            textAnchor="middle" dominantBaseline="central">{rank}</text>
    </svg>
  )
}

/**
 * Confete de fundo do pódio, pedido pelo cliente junto com o cartão escuro.
 *
 * As peças nascem UMA vez (`useMemo` sem dependência): o placar re-renderiza a
 * cada 60s e a cada evento SSE, e sortear posição de novo faria o confete
 * inteiro saltar de lugar na frente de quem está olhando. `animationDelay`
 * negativo entra com o ciclo já em andamento, senão a tela começa vazia e
 * chove tudo de uma vez.
 */
const CONFETE_CORES = ['#F59E0B', '#FDE68A', '#4DE397', '#3DB879', '#E745F7', '#7FB2FF', '#FFFFFF']

function sortearPecas(n, opMin, opVar) {
  return Array.from({ length: n }, (_, i) => {
    const w = 3 + Math.random() * 5
    const dur = 9 + Math.random() * 14
    return {
      i,
      left: Math.random() * 100,
      w,
      h: Math.random() < 0.5 ? w : w * 2.4,
      cor: CONFETE_CORES[Math.floor(Math.random() * CONFETE_CORES.length)],
      op: opMin + Math.random() * opVar,
      dur,
      atraso: -Math.random() * dur,
      redondo: Math.random() < 0.4,
    }
  })
}

function pecaStyle(p) {
  return {
    left: `${p.left}%`,
    width: `${p.w}px`,
    height: `${p.h}px`,
    background: p.cor,
    opacity: p.op,
    borderRadius: p.redondo ? '50%' : '1px',
    animationDuration: `${p.dur}s`,
    animationDelay: `${p.atraso}s`,
  }
}

function Confete({ n = 44 }) {
  const pecas = useMemo(() => sortearPecas(n, 0.1, 0.22), [n])
  return (
    <div className="tv-cf" aria-hidden="true">
      {pecas.map(p => <span key={p.i} className="tv-cf-p" style={pecaStyle(p)} />)}
    </div>
  )
}

/**
 * Confete DENTRO do cartão — o `.confetti-wrap` / `buildConfetti()` do
 * `sales-arena.html`. O do palco fica atrás e o cartão é opaco, então as peças
 * que na referência caem por cima do metal precisam nascer aqui.
 *
 * Diferente do confete do palco: lá as peças atravessam a tela inteira; aqui
 * caem só a altura do cartão (`--fy`) e reiniciam, como no original.
 */
const CONF_CARTAO = ['#FFB800', '#FFD700', '#3DB879', '#4DE397', '#B621C3',
                     '#E745F7', '#C8784A', '#FF6B6B', '#FFFFFF', '#60A5FA']

function ConfeteCartao({ n = 26 }) {
  const pecas = useMemo(() => Array.from({ length: n }, (_, i) => {
    const w = 4 + Math.round(Math.random() * 5)
    return {
      i,
      cor: CONF_CARTAO[i % CONF_CARTAO.length],
      left: Math.random() * 100,
      w,
      h: Math.random() > 0.5 ? w : w * 0.4 + 2,
      raio: Math.random() > 0.6 ? '50%' : Math.random() > 0.5 ? '2px' : '1px',
      fy: 100 + Math.random() * 60,
      fx: Math.round(Math.random() * 60 - 30),
      fr: Math.round((Math.random() > 0.5 ? 1 : -1) * (300 + Math.random() * 400)),
      dur: 2.2 + Math.random() * 2.5,
      atraso: Math.random() * 3,
    }
  }), [n])

  return (
    <div className="tv-cc-cf" aria-hidden="true">
      {pecas.map(p => (
        <span
          key={p.i}
          className="tv-cc-cf-p"
          style={{
            left: `${p.left}%`,
            width: `${p.w}px`,
            height: `${p.h}px`,
            background: p.cor,
            borderRadius: p.raio,
            '--fy': `${p.fy}px`,
            '--fx': `${p.fx}px`,
            '--fr': `${p.fr}deg`,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.atraso}s`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Cartão de destaque — o arranjo do cartão que o cliente fixou como referência,
 * na mesma ordem de leitura, com a moeda desta campanha nos lugares dele:
 *
 *   [medalha][avatar]  Nº LUGAR / nome / equipe
 *   RECUPERAÇÕES / 20                       (o valor grande, sozinho na linha)
 *   PRÓXIMO GIRO · REFERÊNCIA        [giros] (apoio à esquerda, selo à direita)
 *   ▓▓▓▓▓▓▓▓▓▓▓░░░                           (barra fechando o cartão)
 *
 * Três cartões IGUAIS, de propósito: a versão com um líder grande e 2º/3º em
 * linha foi testada e recusada pelo cliente.
 */
function CardDestaque({ item, tierStart }) {
  const r = item.position
  const base = tierStart ?? 0
  const alvo = item.next_at
  const frac = alvo && alvo > base
    ? Math.min(1, Math.max(0, (item.contracts - base) / (alvo - base)))
    : 1
  const giros = Number(item.spins || 0)
  const noTopo = item.missing === null || item.missing === undefined

  return (
    <article className={`tv-cc tv-cc${r}`}>
      <ConfeteCartao n={r === 1 ? 26 : r === 2 ? 18 : 14} />
      {/* os dois blobs radiais que dão profundidade ao cartão do 1º na
          referência (`.r1-glow` / `.r1-glow2`) — sem eles o metal fica chapado */}
      {r === 1 ? (
        <>
          <span className="tv-cc-glow" aria-hidden="true" />
          <span className="tv-cc-glow2" aria-hidden="true" />
        </>
      ) : null}

      {/* Medalha e avatar são IRMÃOS separados por gap, como no `.r1-top` da
          referência — não a medalha montada sobre o avatar. */}
      <div className="tv-cc-top">
        <Medalha rank={r} />
        <div className="tv-cc-av">{iniciais(item.vendor_name)}</div>
        <div className="tv-cc-id">
          <span className="tv-cc-pos">{r}º lugar</span>
          <h3 className="tv-cc-name">{nomeLimpo(item.vendor_name)}</h3>
          {item.team ? <span className="tv-cc-team">{item.team}</span> : null}
        </div>
      </div>

      <div className="tv-cc-hero">
        <span className="tv-cc-hero-lbl">Recuperações</span>
        <span className="tv-cc-hero-val">{item.contracts}</span>
      </div>

      <div className="tv-cc-sub">
        <div className="tv-cc-mi">
          <span className="tv-cc-mi-lbl">Próximo giro</span>
          <span className="tv-cc-mi-val">{noTopo ? '—' : alvo}</span>
        </div>
        <span className="tv-cc-sep" aria-hidden="true" />
        <div className="tv-cc-mi">
          <span className="tv-cc-mi-lbl">Referência</span>
          <span className="tv-cc-mi-val">{BRL.format(item.total_value || 0)}</span>
        </div>
        {giros > 0 ? (
          <span className="tv-cc-giros">{giros} giro{giros > 1 ? 's' : ''}</span>
        ) : null}
      </div>

      {/* Como na referência, a barra fecha o cartão sem texto embaixo: o
          "faltam N para o próximo giro" já está em cada linha do ranking. */}
      <div className="tv-cc-track">
        <div className="tv-cc-fill" style={{ transform: `scaleX(${frac})` }} />
      </div>
    </article>
  )
}

/**
 * A escada, agora deitada acima do ranking.
 *
 * Os três estados de `degraus()` continuam valendo — o que muda é o eixo: o
 * trilho vira uma linha horizontal atrás das marcas, e a fronteira é a única
 * coluna com fundo e nome próprio. Rola de lado quando não couber, porque uma
 * escada de oito degraus numa tela estreita não pode encolher a marca até o
 * número virar ilegível a quatro metros.
 */
function EscadaFaixa({ ladder, board, spinEvery }) {
  const linhas = degraus(ladder, board)
  if (!linhas.length) return null

  return (
    <div className="tv-strip">
      <div className="tv-strip-hd">
        <span className="tv-strip-ttl">Escada do Resgate</span>
        <span className="tv-strip-u">recuperações</span>
        {spinEvery > 0 ? (
          <span className="tv-strip-step">e segue: +1 giro a cada {spinEvery} recuperações</span>
        ) : null}
      </div>

      <ol className="tv-strip-rungs">
        {linhas.map(r => (
          <li
            key={r.at}
            className={`tv-srung is-${r.estado}`}
            aria-current={r.estado === 'next' ? 'step' : undefined}
          >
            <span className="tv-srung-mark">{r.at}</span>
            <span className="tv-srung-ttl">{r.ordinal}º giro</span>
            <span className="tv-srung-sub">
              {r.chegaram > 0
                ? `${r.chegaram} ${r.chegaram === 1 ? 'chegou' : 'chegaram'}`
                : r.maisPerto
                  ? <>
                      falta{r.at - r.maisPerto.contracts === 1 ? '' : 'm'}{' '}
                      <b>{r.at - r.maisPerto.contracts}</b> · {nomeLimpo(r.maisPerto.vendor_name)}
                    </>
                  : ' '}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
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

  // Campanha arquivada do sistema antigo (equipes/score_events): forma de
  // dados totalmente diferente do placar por giro abaixo — pula tudo isso e
  // reaproveita a mesma view do Ranking Equipe/Individual, só que com os
  // dados congelados em vez de buscar ao vivo.
  if (!loading && !error && data?.legacy) {
    return (
      <Telao
        groups={data.snapshot.groups}
        campaign={data.campaign}
        indRankings={data.snapshot.indRankings}
        todayActivity={null}
        onClose={onClose}
        modes={['teams', 'individual']}
        fullscreen={fullscreen}
        limiteIndividual={Infinity}
      />
    )
  }

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
            <span className="tv-back-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                   strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </span>
            <span className="tv-back-txt">Voltar</span>
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
            <Confete />

            {/* O bloco "CAMPANHA DO DIA / <nome>" saiu daqui: o nome já está na
                barra superior e a frase da campanha repetia o "+1 giro a cada N"
                que a escada mostra à direita. Eram ~145px de altura duplicada —
                exatamente o que faltava para os três cartões respirarem. */}
            <div className="tv-podio">
              <div className="tv-left-sec">
                <span>Destaques</span>
                <span className="tv-left-sec-u">
                  {board.length >= 3 ? 'top 3' : board.length === 2 ? 'top 2' : 'líder'}
                </span>
              </div>

              <div className="tv-podio-cards">
                {board.slice(0, 3).map(item => (
                  <CardDestaque key={item.vendor_id} item={item} tierStart={tierStartOf(item)} />
                ))}
              </div>
            </div>
          </aside>

          <section className="tv-right">
            <EscadaFaixa ladder={ladder} board={board} spinEvery={campaign?.spin_every} />

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
