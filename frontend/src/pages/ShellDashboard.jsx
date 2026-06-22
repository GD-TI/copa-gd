import { useState, useEffect } from 'react'
import api from '../api/client'

// Recebe YYYY-MM-DD ou ISO completo — sempre extrai só a data
function d10(s) { return s ? String(s).slice(0, 10) : '' }

function fDate(s) {
  const v = d10(s)
  if (!v) return '—'
  const d = new Date(v + 'T00:00:00')
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function ppct(start, end) {
  const sv = d10(start), ev = d10(end)
  if (!sv || !ev) return 0
  const s = new Date(sv + 'T00:00:00'), e = new Date(ev + 'T23:59:59'), n = new Date()
  if (isNaN(s) || isNaN(e)) return 0
  return Math.min(100, Math.max(0, ((n - s) / (e - s)) * 100))
}

function dleft(end) {
  const ev = d10(end)
  if (!ev) return null
  const d = new Date(ev + 'T23:59:59')
  if (isNaN(d)) return null
  return Math.max(0, Math.ceil((d - new Date()) / 86400000))
}

export default function ShellDashboard({ onNav }) {
  const [groups, setGroups] = useState([])
  const [campaign, setCampaign] = useState(null)

  useEffect(() => {
    api.get('/groups/ranking').then(r => {
      setGroups(r.data.groups || [])
      if (r.data.campaign) setCampaign(r.data.campaign)
    }).catch(() => {})
  }, [])

  const total = groups.reduce((a, g) => a + (Number(g.total_points) || 0), 0)
  const totalGoal = groups.reduce((a, g) => a + (Number(g.goal_points) || 0), 0)
  const leader = groups[0] || null
  const pct = totalGoal > 0 ? Math.min(100, (total / totalGoal) * 100) : 0
  const falta = Math.max(0, totalGoal - total)
  const pp = campaign ? ppct(campaign.start_date, campaign.end_date) : 0
  const days = campaign ? dleft(campaign.end_date) : null
  const pctRound = totalGoal > 0 ? Math.round(pct) : 0

  const ini = (name = '') => {
    const p = name.trim().split(/\s+/)
    return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
  }

  return (
    <>
      <div className="dash-hero">
        <div className="dash-hero-text">
          <div className="dash-hero-label">Campanha Comercial · Grupo Digital</div>
          <div className="dash-hero-title">Copa GD 2026</div>
          <div className="dash-hero-sub">Painel de Resultados em Tempo Real</div>
        </div>
        <div className="dash-hero-badge">⚽ 2026</div>
      </div>

      <div className="pw" style={{ paddingTop: 20 }}>
        <div className="kpi-grid">
          <div className="kpi kpi-gold">
            <div className="kpi-label">Total Acumulado</div>
            <div className="kpi-value c-gold" style={{ fontSize: 20 }}>{total.toLocaleString('pt-BR')} pts</div>
            <div className="kpi-sub">pontos no período</div>
          </div>
          <div className="kpi kpi-blue">
            <div className="kpi-label">Grupos</div>
            <div className="kpi-value c-blue">{groups.length}</div>
            <div className="kpi-sub">no ranking</div>
          </div>
          <div className="kpi kpi-green">
            <div className="kpi-label">Campanha</div>
            <div className="kpi-value c-green" style={{ fontSize: 18, letterSpacing: 0 }}>
              {days !== null ? (days > 0 ? `${days} dias` : 'Encerrada') : '—'}
            </div>
            <div className="kpi-sub">restantes</div>
          </div>
          <div className="kpi kpi-violet">
            <div className="kpi-label">Líder Atual</div>
            <div className="kpi-value c-violet" style={{ fontSize: 18, letterSpacing: 0 }}>
              {leader ? leader.name.split(' ')[0] : '—'}
            </div>
            <div className="kpi-sub">{leader ? `${(leader.total_points || 0).toLocaleString('pt-BR')} pts` : '—'}</div>
          </div>
        </div>

        <div className="card">
          <div className="prog-wrap">
            <div className="prog-header">
              <span className="prog-label">🏆 Meta Coletiva do Time</span>
              <span className="prog-value">{totalGoal > 0 ? pctRound + '%' : '—'}</span>
            </div>
            <div className="prog-track">
              <div className="prog-fill" style={{ width: pct + '%' }} />
            </div>
            <div className="prog-foot">
              <span className="prog-pct">
                {totalGoal > 0 ? `${total.toLocaleString('pt-BR')} de ${totalGoal.toLocaleString('pt-BR')} pts` : '—'}
              </span>
              <div className={`prog-rem${totalGoal > 0 && falta === 0 ? ' done' : ''}`}>
                {totalGoal > 0 && falta > 0
                  ? <span>Faltam <strong>{falta.toLocaleString('pt-BR')} pts</strong></span>
                  : totalGoal > 0 ? <strong>✓ Meta coletiva atingida!</strong> : null}
              </div>
            </div>
          </div>

          <div className="period-row">
            <div className="period-item">
              <span className="period-lbl">Início</span>
              <span className="period-val">{campaign ? fDate(campaign.start_date) : '—'}</span>
            </div>
            <span className="period-sep">→</span>
            <div className="period-item">
              <span className="period-lbl">Fim</span>
              <span className="period-val">{campaign ? fDate(campaign.end_date) : '—'}</span>
            </div>
            <div className="period-bar-wrap">
              <div className="period-bar-head">
                <span>Progresso da campanha</span>
                <span>{days !== null ? (days > 0 ? `${days} dias restantes` : 'Encerrada') : '—'}</span>
              </div>
              <div className="period-bar-track">
                <div className="period-bar-fill" style={{ width: pp + '%' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="dash-actions">
          <button className="btn btn-gold" onClick={() => onNav('ranking')}>🏆 Ver Ranking</button>
          <button className="btn btn-ghost" onClick={() => onNav('config')}>⚙️ Configurar</button>
        </div>
      </div>
    </>
  )
}
