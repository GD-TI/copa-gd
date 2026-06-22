import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import ShellRanking from '../pages/ShellRanking'
import ShellConfig from '../pages/ShellConfig'
import ShellMyGroup from '../pages/ShellMyGroup'
import { applyTheme, writeThemeCookie } from '../utils/theme'
import '../shell.css'

const PAGE_TITLES = { ranking: 'Ranking', config: 'Configuração', meugrupo: 'Meu Grupo' }

export default function Shell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [page, setPage] = useState('ranking')
  const [collapsed, setSidebarCollapsed] = useState(false)
  const [mobOpen, setMobOpen] = useState(false)
  const [clock, setClock] = useState('')
  const [dateStr, setDateStr] = useState('')

  // Clock tick
  useEffect(() => {
    function tick() {
      const n = new Date()
      setClock(n.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDateStr(n.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase())
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  // Theme — cookie aplicado no index.html antes do React (evita flash)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light')
  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    writeThemeCookie(next)
    setTheme(next)
  }, [theme])

  const navTo = (p) => { setPage(p); setMobOpen(false) }

  const handleLogout = () => { logout(); navigate('/login') }

  const ini = (name = '') => {
    const p = name.trim().split(/\s+/)
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="shell">
      {/* ── Sidebar ── */}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobOpen ? 'mob-open' : ''}`}>
        <div className="sb-brand">
          <svg className="sb-logo" viewBox="0 0 308.52 137.73" xmlns="http://www.w3.org/2000/svg">
            <path className="sb-logo-mark" d="M176.6,57.06c-6.11,0-10.83,1.61-14.16,4.82-3.33,3.22-4.99,7.77-4.99,13.67v23.61c0,3.94-2.04,5.9-6.11,5.9h-74.77c-2.4,0-4.69-.13-6.88-.39-1.06-.12-2.1-.28-3.11-.47-.1-.02-.19-.03-.29-.05-.99-.19-1.95-.4-2.88-.65-.11-.03-.23-.06-.34-.09-1.86-.51-3.63-1.13-5.29-1.87-.14-.06-.27-.12-.41-.19-.8-.37-1.58-.76-2.33-1.19-.08-.05-.16-.1-.25-.15-.69-.4-1.37-.83-2.02-1.28-.11-.07-.22-.14-.32-.22-.68-.48-1.33-.99-1.96-1.52-.13-.11-.26-.23-.39-.34-.64-.55-1.25-1.13-1.84-1.74-6.52-6.75-9.78-15.45-9.78-26.07s3.26-19.31,9.78-26.07c6.52-6.75,15.95-10.13,28.31-10.13h9.13c5.56,0,9.81-1.44,12.73-4.33,2.92-2.88,4.38-6.89,4.38-12,0-10.89-5.7-16.33-17.11-16.33h-13.61C48.88,0,31.06,6.43,18.63,19.28,6.21,32.14,0,48.67,0,68.86s6.21,36.73,18.63,49.58c12.42,12.86,30.24,19.28,53.46,19.28h93.51c9.77,0,17.24-2.49,22.4-7.48,5.16-4.98,7.74-12.07,7.74-21.25v-33.45c0-5.9-1.67-10.46-4.99-13.67-3.33-3.21-8.04-4.82-14.15-4.82Z"/>
            <path className="sb-logo-mark" d="M289.88,19.28c-12.42-12.86-30.24-19.28-53.46-19.28h-93.51c-9.77,0-17.24,2.49-22.4,7.48-5.16,4.98-7.74,12.07-7.74,21.25v33.45c0,5.9,1.67,10.46,4.99,13.67,3.33,3.21,8.05,4.82,14.15,4.82s10.83-1.61,14.16-4.82c3.33-3.22,4.99-7.77,4.99-13.67v-23.61c0-3.94,2.04-5.9,6.11-5.9h74.14c3.01.29,5.56.37,7.49.38,0,0,.01,0,.02,0,1.06.12,2.1.28,3.11.47.1.02.19.03.29.05.99.19,1.95.4,2.88.65.11.03.23.06.34.09,1.86.51,3.63,1.13,5.29,1.87.14.06.28.12.41.19.8.37,1.58.76,2.33,1.19.08.05.17.1.25.15.69.4,1.37.83,2.02,1.28.11.07.22.14.32.22.68.48,1.33.99,1.96,1.52.13.11.26.23.39.34.64.55,1.26,1.13,1.84,1.74,6.52,6.75,9.78,15.45,9.78,26.07s-3.26,19.31-9.78,26.07c-6.52,6.75-15.95,10.13-28.31,10.13h-9.13c-2.78,0-5.23.36-7.36,1.08-2.12.72-3.91,1.8-5.37,3.25-2.92,2.88-4.38,6.89-4.38,12,0,10.89,5.7,16.33,17.11,16.33h13.61c23.22,0,41.04-6.43,53.46-19.28,12.42-12.86,18.63-29.38,18.63-49.58s-6.21-36.73-18.63-49.58Z"/>
          </svg>
          <div className="sb-name-wrap">
            <div className="sb-name">COPA GD</div>
            <div className="sb-sub">Campanha 2026</div>
          </div>
        </div>

        <nav className="sb-nav">
          <div className={`sb-item ${page === 'ranking' ? 'active' : ''}`} onClick={() => navTo('ranking')}>
            <div className="sb-item-icon">🏆</div>
            <span className="sb-item-lbl">Ranking</span>
          </div>
          {user?.role === 'player' && (
            <div className={`sb-item ${page === 'meugrupo' ? 'active' : ''}`} onClick={() => navTo('meugrupo')}>
              <div className="sb-item-icon">⚽</div>
              <span className="sb-item-lbl">Meu Grupo</span>
            </div>
          )}
          {user?.role === 'admin' && (
            <div className={`sb-item ${page === 'config' ? 'active' : ''}`} onClick={() => navTo('config')}>
              <div className="sb-item-icon">⚙️</div>
              <span className="sb-item-lbl">Configuração</span>
            </div>
          )}
          {user?.role === 'team_admin' && (
            <div className={`sb-item ${page === 'config' ? 'active' : ''}`} onClick={() => navTo('config')}>
              <div className="sb-item-icon">⚙️</div>
              <span className="sb-item-lbl">Minhas Equipes</span>
            </div>
          )}
        </nav>

        <div className="sb-foot">
          {/* User info */}
          <div style={{ padding: '4px 10px 8px', borderBottom: '1px solid var(--sb-border)', marginBottom: 4, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--gold-mid)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                {ini(user?.display_name || user?.username)}
              </div>
              <div className="sb-name-wrap" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.display_name || user?.username}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {user?.role === 'admin' ? 'Admin' : user?.role === 'team_admin' ? 'Sub-admin' : 'Jogador'}
                </div>
              </div>
            </div>
          </div>

          <button className="sb-foot-btn" onClick={toggleTheme}>
            <div className="sb-foot-icon">
              <div className="theme-pill"><div className="theme-dot" /></div>
            </div>
            <span className="sb-foot-lbl">Tema</span>
          </button>
          <button className="sb-foot-btn" onClick={() => setSidebarCollapsed(v => !v)}>
            <div className="sb-foot-icon" style={{ fontSize: 13 }}>{collapsed ? '▶' : '◀'}</div>
            <span className="sb-foot-lbl">Recolher</span>
          </button>
          <button className="sb-foot-btn" onClick={handleLogout}>
            <div className="sb-foot-icon" style={{ fontSize: 13 }}>⏻</div>
            <span className="sb-foot-lbl">Sair</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobOpen && <div className="mob-overlay show" onClick={() => setMobOpen(false)} />}

      {/* ── Main ── */}
      <div className="main">
        <div className="topbar">
          <div className="tb-left">
            <button className="tb-hamburger" onClick={() => setMobOpen(true)}>☰</button>
            <span className="tb-title">{PAGE_TITLES[page]}</span>
          </div>
          <div className="tb-right">
            <span className="tb-date">{dateStr}</span>
            <span className="tb-clock">{clock}</span>
          </div>
        </div>

        <div className="pages">
          <div className={`page ${page === 'ranking' ? 'active' : ''}`}>
            <ShellRanking />
          </div>
          {user?.role === 'player' && (
            <div className={`page ${page === 'meugrupo' ? 'active' : ''}`}>
              <ShellMyGroup />
            </div>
          )}
          {(user?.role === 'admin' || user?.role === 'team_admin') && (
            <div className={`page ${page === 'config' ? 'active' : ''}`}>
              <ShellConfig />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
