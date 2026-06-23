import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'

export default function ShellRankingToday() {
  const [data, setData]                 = useState(null)
  const [loading, setLoading]           = useState(true)
  const [sseConnected, setSseConnected] = useState(false)
  const [lastUpdate, setLastUpdate]     = useState(null)
  const debounceRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/scores/today-activity')
      setData(r.data)
    } catch (e) {}
    setLoading(false)
    setLastUpdate(new Date())
  }, [])

  useEffect(() => {
    load()
    const es = new EventSource('/api/events/stream')
    es.addEventListener('scores_updated', () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => load(), 800)
    })
    es.onerror = () => setSseConnected(false)
    es.onopen  = () => setSseConnected(true)
    const t = setInterval(load, 300000)
    return () => { es.close(); clearInterval(t); clearTimeout(debounceRef.current) }
  }, [load])

  const groups = data?.groups || []

  return (
    <>
      <div className="rank-bar">
        <span className="rank-count-lbl">
          {loading ? 'Carregando…' : groups.length === 0 ? 'Nenhuma equipe pontuou hoje ainda' : `${groups.length} equipe${groups.length !== 1 ? 's' : ''} pontuaram hoje`}
        </span>
        <div className="rank-bar-live">
          <span className={`live-dot${sseConnected ? ' live-on' : ''}`} />
          <span className="live-lbl">{sseConnected ? 'Ao vivo' : 'Reconectando…'}</span>
          {lastUpdate && (
            <span className="live-time">
              {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {!loading && groups.length === 0 && (
        <div className="td-empty-state">Nenhuma equipe pontuou hoje ainda. O próximo cálculo roda em até 5 minutos.</div>
      )}

      <div className="td-grid">
        {groups.map(g => (
          <div key={g.id} className="td-card">
            <div className="td-card-head">
              {g.photo_url
                ? <img src={g.photo_url} alt={g.name} className="td-team-photo" />
                : <div className="td-team-avatar">{g.name.slice(0, 2).toUpperCase()}</div>
              }
              <span className="td-team-name">{g.name}</span>
              <span className="td-today-pts">+{g.today_points} pts hoje</span>
            </div>

            <div className="td-events">
              {g.events.map((ev, i) => (
                <div key={i} className="td-event">
                  <span className="td-ev-icon">{ev.icon}</span>
                  <div className="td-ev-body">
                    <div className="td-ev-top">
                      <span className="td-ev-label">{ev.label}</span>
                      {ev.is_double && <span className="td-ev-double">🇧🇷 ×2</span>}
                      <span className="td-ev-pts">+{ev.points}</span>
                    </div>
                    {ev.description && <div className="td-ev-desc">{ev.description}</div>}
                  </div>
                </div>
              ))}
            </div>

            {g.top_players?.length > 0 && (
              <div className="td-players">
                <div className="td-players-title">Jogadores hoje</div>
                {g.top_players.map((p, i) => (
                  <div key={i} className="td-player">
                    <span className="td-pl-name">{p.name}</span>
                    <span className="td-pl-stats">
                      {p.pagos > 0 && `${p.pagos} pago${p.pagos !== 1 ? 's' : ''}`}
                      {p.pagos > 0 && p.valor > 0 && ' · '}
                      {p.valor > 0 && `R$ ${p.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                      {p.pagos === 0 && p.contratos > 0 && `${p.contratos} proposta${p.contratos !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
