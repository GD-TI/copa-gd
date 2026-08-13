/**
 * O telão. **Não é mais uma página** — a "Ranking Equipe" saiu do menu em
 * 13/08/2026: ela era o placar da Copa GD 2026, encerrada em 31/07, e o mesmo
 * placar já está no card arquivado dentro de Campanhas.
 *
 * Sobrou o `Telao`, com dois consumidores:
 *   • `CampaignBoard.jsx` — snapshot congelado da Copa (`['teams','individual']`)
 *   • `components/TelaoRankings.jsx` — TV do mês / digitados (`['mensal','digitados']`)
 *
 * O arquivo mantém o nome porque é assim que o CLAUDE.md e o histórico o
 * referenciam; renomear só trocaria o custo de lugar.
 */
import { useState, useEffect } from 'react'
import { RankingLista, RankingResumo } from '../components/RankingIndividual'

function d10(s) { return s ? String(s).slice(0, 10) : '' }

function dleft(end) {
  const ev = d10(end)
  if (!ev) return null
  const d = new Date(ev + 'T23:59:59')
  if (isNaN(d)) return null
  return Math.max(0, Math.ceil((d - new Date()) / 86400000))
}

function ini(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

const MEDALS = ['🥇', '🥈', '🥉']

// ── Telão components ────────────────────────────────────────

function TelaoChampCard({ group, rank }) {
  const cls = ['c1', 'c2', 'c3'][rank]
  const pts = Number(group.total_points) || 0
  const meta = Number(group.goal_points) || 0
  const pct = meta > 0 ? Math.min(100, Math.round((pts / meta) * 100)) : null
  const hit = pct !== null && pct >= 100

  return (
    <div className={`tl-cc ${cls}`}>
      {rank === 0 && <div className="tl-cc-crown">👑</div>}
      <div className="tl-cc-wm">{rank + 1}</div>
      <div className="tl-cc-av-wrap">
        <div className="tl-cc-av">
          {group.photo_url ? <img src={group.photo_url} alt="" /> : ini(group.name)}
        </div>
        <div className="tl-cc-rb">{MEDALS[rank]}</div>
      </div>
      <div className="tl-cc-info">
        <span className="tl-cc-rank-lbl">{rank + 1}º lugar</span>
        <div className="tl-cc-name">{group.name}</div>
        {group.member_count > 0 && (
          <div className="tl-cc-team">{group.member_count} membro{group.member_count !== 1 ? 's' : ''}</div>
        )}
        <div className="tl-cc-val">{pts.toLocaleString('pt-BR')} pts</div>
        {pct !== null && (
          <div className="tl-cc-prog">
            <div className="tl-cc-pbar">
              <div className="tl-cc-pfill" style={{ width: Math.min(100, pct) + '%' }} />
            </div>
            <div className="tl-cc-prow">
              <span className="tl-cc-ppct">{pct}%{hit ? ' ✓' : ''}</span>
              {!hit && meta > 0 && (
                <span className="tl-cc-pfalta">falta {Math.max(0, meta - pts).toLocaleString('pt-BR')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TelaoRankRow({ group, rank }) {
  const pts = Number(group.total_points) || 0
  const meta = Number(group.goal_points) || 0
  const pct = meta > 0 ? Math.min(100, Math.round((pts / meta) * 100)) : null
  const hit = pct !== null && pct >= 100
  const rCls = rank < 3 ? ` r${rank + 1}` : ''

  return (
    <div className={`tl-rrow${rCls}`} style={{ animationDelay: rank * 0.04 + 's' }}>
      <div className={`tl-pos${rank < 3 ? ' medal' : ''}`}>
        {rank < 3 ? MEDALS[rank] : rank + 1}
      </div>
      <div className="tl-rav">
        {group.photo_url ? <img src={group.photo_url} alt="" /> : ini(group.name)}
      </div>
      <div>
        <div className="tl-rname">{group.name}</div>
        {group.member_count > 0 && (
          <div className="tl-rteam">{group.member_count} membro{group.member_count !== 1 ? 's' : ''}</div>
        )}
      </div>
      <div className="tl-rval">{pts.toLocaleString('pt-BR')} pts</div>
      {pct !== null ? (
        <div className="tl-rprog">
          <div className="tl-rpbar">
            <div className={`tl-rpfill ${hit ? 'rfh' : 'rfm'}`} style={{ width: Math.min(100, pct) + '%' }} />
          </div>
          <div className={`tl-rppct ${hit ? 'h' : 'm'}`}>{pct}%</div>
        </div>
      ) : <div />}
      <div>
        {hit
          ? <span className="tl-rpill ph">✓ Meta</span>
          : meta > 0
          ? <span className="tl-rpill pm">Pendente</span>
          : <span className="tl-rpill px">—</span>}
      </div>
    </div>
  )
}

const TL_BALL_LABELS = ['Bola de Ouro', 'Bola de Prata', 'Bola de Bronze']
const TL_BALL_CLS    = ['tl-ir-gold', 'tl-ir-silver', 'tl-ir-bronze']
const TL_ASSIST_ICONS = ['🥇', '🥈', '🥉']

// `limite` = 5 na TV: cinco linhas é o que se lê de longe, e a tela rotaciona
// sozinha. No placar arquivado, aberto de perto para consulta, a lista vem
// inteira e rola.
function TelaoIndView({ indRankings, limite = 5 }) {
  const mv = (indRankings?.melhor_vendedor || []).slice(0, limite)
  const ra = (indRankings?.rei_assistencias || []).slice(0, limite)
  return (
    <div className="tl-ind-body">
      <div className="tl-ind-col">
        <div className="tl-ind-col-head">⚽ Melhor Vendedor <span className="tl-ind-col-n">{mv.length}</span></div>
        <div className="tl-ind-list">
        {mv.length === 0
          ? <div className="tl-ind-empty">Sem dados</div>
          : mv.map((item, i) => (
            <div key={item.vendedor_id} className={`tl-ir-row ${TL_BALL_CLS[i] || ''}`}>
              <div className="tl-ir-medal">
                {i < 3 ? (
                  <>
                    <span className="tl-ir-icon">⚽</span>
                    <span className="tl-ir-lbl">{TL_BALL_LABELS[i]}</span>
                  </>
                ) : (
                  <span className="tl-ir-lbl">{i + 1}º</span>
                )}
              </div>
              <div className="tl-ir-name">{item.name}</div>
              <div className="tl-ir-val">R$ {item.total_valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            </div>
          ))
        }
        </div>
      </div>
      <div className="tl-ind-divider" />
      <div className="tl-ind-col">
        <div className="tl-ind-col-head">🤝 Rei das Assistências <span className="tl-ind-col-n">{ra.length}</span></div>
        <div className="tl-ind-list">
        {ra.length === 0
          ? <div className="tl-ind-empty">Sem dados</div>
          : ra.map((item, i) => (
            <div key={item.vendedor_id} className={`tl-ir-row ${TL_BALL_CLS[i] || ''}`}>
              <div className="tl-ir-medal">
                {i < 3 ? (
                  <>
                    <span className="tl-ir-icon">{TL_ASSIST_ICONS[i]}</span>
                    <span className="tl-ir-lbl">{i + 1}º lugar</span>
                  </>
                ) : (
                  <span className="tl-ir-lbl">{i + 1}º</span>
                )}
              </div>
              <div className="tl-ir-name">{item.name}</div>
              <div className="tl-ir-val">{item.indicacao_count} indicaç{item.indicacao_count === 1 ? 'ão' : 'ões'}</div>
            </div>
          ))
        }
        </div>
      </div>
    </div>
  )
}

function TelaoTodayView({ todayActivity }) {
  const groups = todayActivity?.groups || []
  if (groups.length === 0) {
    return (
      <div className="tl-today-empty">Nenhuma equipe pontuou ainda hoje</div>
    )
  }
  return (
    <div className="tl-today-body">
      {groups.map(g => (
        <div key={g.id} className="tl-td-card">
          <div className="tl-td-head">
            {g.photo_url
              ? <img src={g.photo_url} alt={g.name} className="tl-td-photo" />
              : <div className="tl-td-avatar">{g.name.slice(0, 2).toUpperCase()}</div>
            }
            <span className="tl-td-name">{g.name}</span>
            <span className="tl-td-pts">+{g.today_points} pts</span>
          </div>
          <div className="tl-td-events">
            {g.events.map((ev, i) => (
              <span key={i} className="tl-td-badge">
                {ev.icon} {ev.label} <strong>+{ev.points}</strong>
                {ev.is_double && ' 🇧🇷'}
              </span>
            ))}
          </div>
          {g.top_players?.length > 0 && (
            <div className="tl-td-players">
              {g.top_players.slice(0, 3).map((p, i) => (
                <span key={i} className="tl-td-player">
                  {p.name}{p.pagos > 0 ? ` · ${p.pagos}✓` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Ranking individual do mês e digitados do dia, com a lista rolando sozinha.
 *
 * São modos novos ao lado de `individual`/`today`, e não no lugar deles: os
 * antigos continuam servindo o snapshot congelado da Copa GD 2026 no card
 * arquivado, que tem outra forma de dado (`melhor_vendedor`/`rei_assistencias`).
 */
function TelaoMensalView({ mensal }) {
  return (
    <div className="ri-telao-body">
      <RankingResumo dados={mensal} unidade="contratos pagos" />
      <RankingLista
        dados={mensal}
        variante="mensal"
        vazio="Nenhum contrato pago no mês ainda"
        rolarAPartirDe={8}
      />
    </div>
  )
}

function TelaoDigitadosView({ digitados }) {
  return (
    <div className="ri-telao-body">
      <RankingResumo dados={digitados} unidade="digitados" />
      <RankingLista
        dados={digitados}
        variante="digitados"
        vazio="Nenhum contrato digitado hoje ainda"
        rolarAPartirDe={8}
      />
    </div>
  )
}

const MODO_LABEL = {
  teams:      'Ranking por Equipe',
  mensal:     '🏅 Ranking do Mês',
  digitados:  '⌨️ Digitados do Dia',
  individual: '🏅 Rankings Individuais',
  today:      '⚡ Pontos do Dia',
}

// `groups = []` é o telão sem equipe nenhuma — o do mês/digitados. A régua de
// meta coletiva e o ticker são da competição por equipes, então somem junto:
// com a lista vazia mostrariam "0 / —" e uma faixa correndo em branco.
export function Telao({
  groups = [], campaign, indRankings, todayActivity, mensal, digitados, onClose,
  modes = ['teams', 'mensal', 'digitados'], fullscreen = true, limiteIndividual = 5,
}) {
  const [tlLight, setTlLight] = useState(false)
  const [clock, setClock] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [tlMode, setTlMode]   = useState(modes[0]) // um de `modes`
  const [tlFade, setTlFade]   = useState(false)
  // Quem clicou assumiu o controle: a rotação automática para. Sem isso a tela
  // pularia sozinha no meio da leitura, que é pior do que não ter botão.
  const [tlManual, setTlManual] = useState(false)

  useEffect(() => {
    const tick = () => {
      const n = new Date()
      setClock(n.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDateStr(n.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase())
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Tela cheia só quando a intenção é a TV. Abrir um placar arquivado para
  // conferir não deve sequestrar a tela — a pessoa quer olhar, trocar de
  // ranking e voltar ao que estava fazendo.
  useEffect(() => {
    if (!fullscreen) return
    document.documentElement.requestFullscreen?.().catch(() => {})
    return () => { document.exitFullscreen?.().catch(() => {}) }
  }, [fullscreen])

  // Cicla entre os modos disponíveis a cada 5 minutos com fade. Um snapshot
  // congelado passa só ['teams','individual'] — sem intervalo pra ciclar,
  // fica parado no único modo (não faz sentido "Pontos do Dia" de um
  // histórico que não tem "hoje").
  useEffect(() => {
    if (modes.length < 2 || tlManual) return
    const t = setInterval(() => {
      setTlFade(true)
      setTimeout(() => {
        setTlMode(m => modes[(modes.indexOf(m) + 1) % modes.length])
        setTlFade(false)
      }, 500)
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [modes, tlManual])

  const trocarModo = alvo => {
    if (alvo === tlMode) return
    setTlManual(true)
    setTlFade(true)
    setTimeout(() => { setTlMode(alvo); setTlFade(false) }, 250)
  }

  const total = groups.reduce((a, g) => a + (Number(g.total_points) || 0), 0)
  const totalGoal = groups.reduce((a, g) => a + (Number(g.goal_points) || 0), 0)
  const pct = totalGoal > 0 ? Math.min(100, (total / totalGoal) * 100) : 0
  const hit = groups.filter(g => Number(g.goal_points) > 0 && Number(g.total_points) >= Number(g.goal_points)).length
  const pending = groups.filter(g => Number(g.goal_points) > 0 && Number(g.total_points) < Number(g.goal_points)).length

  const days = campaign ? dleft(campaign.end_date) : null
  const top3 = groups.slice(0, 3)
  const temEquipes = groups.length > 0
  const ehTelaoCopa = campaign?.legacy_kind === 'team_scoring'

  return (
    <div className={`telao${tlLight ? ' tl-light' : ''}${ehTelaoCopa ? ' tl-copa-campanha' : ''}`}>
      {/* Background */}
      <div className="tl-bg">
        <div className="tl-bg-mesh" />
        <svg className="tl-field-svg" viewBox="0 0 2200 600" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="60" y="20" width="2080" height="560" stroke="white" strokeWidth="3"/>
          <line x1="1100" y1="20" x2="1100" y2="580" stroke="white" strokeWidth="3"/>
          <circle cx="1100" cy="300" r="120" stroke="white" strokeWidth="3"/>
          <rect x="60" y="160" width="220" height="280" stroke="white" strokeWidth="3"/>
          <rect x="2020" y="160" width="220" height="280" stroke="white" strokeWidth="3"/>
          <path d="M280 200 A120 120 0 0 1 280 400" stroke="white" strokeWidth="3" fill="none"/>
          <path d="M2020 200 A120 120 0 0 0 2020 400" stroke="white" strokeWidth="3" fill="none"/>
        </svg>
      </div>
      <div className="tl-stripe t" />
      <div className="tl-stripe b" />

      <button className="tl-close-btn" onClick={onClose}>✕ Fechar (Esc)</button>

      <div className="tl-content">
        {/* Header */}
        <div className="tl-header">
          <div className="tl-hd-l">
            <svg className="tl-logo" viewBox="0 0 308.52 137.73" xmlns="http://www.w3.org/2000/svg">
              <path d="M176.6,57.06c-6.11,0-10.83,1.61-14.16,4.82-3.33,3.22-4.99,7.77-4.99,13.67v23.61c0,3.94-2.04,5.9-6.11,5.9h-74.77c-2.4,0-4.69-.13-6.88-.39-1.06-.12-2.1-.28-3.11-.47-.1-.02-.19-.03-.29-.05-.99-.19-1.95-.4-2.88-.65-.11-.03-.23-.06-.34-.09-1.86-.51-3.63-1.13-5.29-1.87-.14-.06-.27-.12-.41-.19-.8-.37-1.58-.76-2.33-1.19-.08-.05-.16-.1-.25-.15-.69-.4-1.37-.83-2.02-1.28-.11-.07-.22-.14-.32-.22-.68-.48-1.33-.99-1.96-1.52-.13-.11-.26-.23-.39-.34-.64-.55-1.25-1.13-1.84-1.74-6.52-6.75-9.78-15.45-9.78-26.07s3.26-19.31,9.78-26.07c6.52-6.75,15.95-10.13,28.31-10.13h9.13c5.56,0,9.81-1.44,12.73-4.33,2.92-2.88,4.38-6.89,4.38-12,0-10.89-5.7-16.33-17.11-16.33h-13.61C48.88,0,31.06,6.43,18.63,19.28,6.21,32.14,0,48.67,0,68.86s6.21,36.73,18.63,49.58c12.42,12.86,30.24,19.28,53.46,19.28h93.51c9.77,0,17.24-2.49,22.4-7.48,5.16-4.98,7.74-12.07,7.74-21.25v-33.45c0-5.9-1.67-10.46-4.99-13.67-3.33-3.21-8.04-4.82-14.15-4.82Z"/>
              <path d="M289.88,19.28c-12.42-12.86-30.24-19.28-53.46-19.28h-93.51c-9.77,0-17.24,2.49-22.4,7.48-5.16,4.98-7.74,12.07-7.74,21.25v33.45c0,5.9,1.67,10.46,4.99,13.67,3.33,3.21,8.05,4.82,14.15,4.82s10.83-1.61,14.16-4.82c3.33-3.22,4.99-7.77,4.99-13.67v-23.61c0-3.94,2.04-5.9,6.11-5.9h74.14c3.01.29,5.56.37,7.49.38,0,0,.01,0,.02,0,1.06.12,2.1.28,3.11.47.1.02.19.03.29.05.99.19,1.95.4,2.88.65.11.03.23.06.34.09,1.86.51,3.63,1.13,5.29,1.87.14.06.28.12.41.19.8.37,1.58.76,2.33,1.19.08.05.17.1.25.15.69.4,1.37.83,2.02,1.28.11.07.22.14.32.22.68.48,1.33.99,1.96,1.52.13.11.26.23.39.34.64.55,1.26,1.13,1.84,1.74,6.52,6.75,9.78,15.45,9.78,26.07s-3.26,19.31-9.78,26.07c-6.52,6.75-15.95,10.13-28.31,10.13h-9.13c-2.78,0-5.23.36-7.36,1.08-2.12.72-3.91,1.8-5.37,3.25-2.92,2.88-4.38,6.89-4.38,12,0,10.89,5.7,16.33,17.11,16.33h13.61c23.22,0,41.04-6.43,53.46-19.28,12.42-12.86,18.63-29.38,18.63-49.58s-6.21-36.73-18.63-49.58Z"/>
            </svg>
            <div className="tl-hd-sep" />
            <div className="tl-hd-tag">Grupo Digital · Campanha Comercial</div>
          </div>
          <div className="tl-hd-c">
            <div className="tl-hd-title">🏆 {campaign?.name || 'RANKING GD'}</div>
            {modes.length > 1 ? (
              <div className="tl-hd-modes">
                {modes.map(m => (
                  <button
                    key={m}
                    className={`tl-hd-mode${tlMode === m ? ' is-on' : ''}`}
                    onClick={() => trocarModo(m)}
                    aria-pressed={tlMode === m}
                  >
                    {MODO_LABEL[m]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="tl-hd-sub">{MODO_LABEL[tlMode]}</div>
            )}
          </div>
          <div className="tl-hd-r">
            <div className="tl-hd-info">
              <div className="tl-clock">{clock}</div>
              <div className="tl-date">{dateStr}</div>
            </div>
            <button className="tl-theme-btn" onClick={() => setTlLight(v => !v)} title="Alternar tema">
              {tlLight ? '🌙' : '☀️'}
            </button>
          </div>
        </div>

        {/* Meta bar — só existe competição por equipe */}
        {temEquipes && (
        <div className="tl-meta-bar">
          <span className="tlm-lbl">🏆 Meta Coletiva</span>
          <div className="tlm-vals">
            <span className="tlm-cur">{total.toLocaleString('pt-BR')}</span>
            <span className="tlm-sl">/</span>
            <span className="tlm-tgt">{totalGoal > 0 ? totalGoal.toLocaleString('pt-BR') + ' pts' : '—'}</span>
          </div>
          <span className="tlm-pct">{totalGoal > 0 ? Math.round(pct) + '%' : '—'}</span>
          <div className="tlm-bar">
            <div className="tlm-fill" style={{ width: pct + '%' }} />
          </div>
          <div className="tlm-stats">
            <div className="tlm-stat">
              <span className="tlm-stat-n" style={{ color: 'var(--tl-txt)' }}>{groups.length}</span>
              <span className="tlm-stat-l">Grupos</span>
            </div>
            <div className="tlm-stat">
              <span className="tlm-stat-n" style={{ color: '#34D399' }}>{hit}</span>
              <span className="tlm-stat-l">Bateram</span>
            </div>
            <div className="tlm-stat">
              <span className="tlm-stat-n" style={{ color: '#F87171' }}>{pending}</span>
              <span className="tlm-stat-l">Pendentes</span>
            </div>
            {days !== null && (
              <div className="tlm-stat">
                <span className="tlm-stat-n" style={{ color: '#60A5FA' }}>{days > 0 ? days : '✓'}</span>
                <span className="tlm-stat-l">{days > 0 ? 'Dias' : 'Encerrada'}</span>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Body — fade on mode switch */}
        <div className={`tl-body${tlFade ? ' tl-body-fade' : ''}`}>
          {tlMode === 'teams' ? (
            <>
              {/* Left: champion stacked cards */}
              <div className="tl-champ-col">
                {top3.map((g, i) => <TelaoChampCard key={g.id} group={g} rank={i} />)}
              </div>
              {/* Right: full ranking */}
              <div className="tl-rank-col">
                <div className="tl-col-title">📊 Classificação Completa</div>
                <div className="tl-rank-scroll">
                  {groups.map((g, i) => <TelaoRankRow key={g.id} group={g} rank={i} />)}
                </div>
              </div>
            </>
          ) : tlMode === 'mensal' ? (
            <TelaoMensalView mensal={mensal} />
          ) : tlMode === 'digitados' ? (
            <TelaoDigitadosView digitados={digitados} />
          ) : tlMode === 'individual' ? (
            <TelaoIndView indRankings={indRankings} limite={limiteIndividual} />
          ) : (
            <TelaoTodayView todayActivity={todayActivity} />
          )}
        </div>

        {/* Ticker — idem: a faixa é o desfile das equipes */}
        {temEquipes && (
        <div className="tl-ticker">
          <div className="tl-ticker-lbl">🏆 Ranking GD</div>
          <div className="tl-ticker-track">
            <div className="tl-ticker-inner">
              {[...groups, ...groups].map((g, i) => (
                <span className="tl-ti" key={i}>
                  <span className="tn">{g.name}</span>
                  <span className="ts">·</span>
                  {Number(g.total_points).toLocaleString('pt-BR')} pts
                </span>
              ))}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
