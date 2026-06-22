import { useState, useEffect } from 'react'
import api from '../api/client'

function showToast(msg) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
    background: 'var(--txt)', color: 'var(--surf)',
    padding: '10px 20px', borderRadius: 10, fontSize: 13,
    fontWeight: 600, boxShadow: 'var(--sh-lg)',
    opacity: 1, transition: 'opacity .3s'
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 350) }, 2500)
}

function ini(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

function toDateInput(val) {
  if (!val) return ''
  return String(val).slice(0, 10)
}

function fBRL(v) {
  const n = parseFloat(v) || 0
  return n > 0 ? 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—'
}

export default function ShellConfig() {
  const [cfgStart, setCfgStart] = useState('')
  const [cfgEnd, setCfgEnd] = useState('')
  const [cfgName, setCfgName] = useState('Copa GD 2026')
  const [groups, setGroups] = useState([])
  // draft: { [group_id]: { daily: string, weekly: string } }
  const [draft, setDraft] = useState({})
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [savingGoals, setSavingGoals] = useState(false)

  useEffect(() => {
    api.get('/settings/campaign').then(r => {
      const c = r.data
      setCfgStart(toDateInput(c.start_date))
      setCfgEnd(toDateInput(c.end_date))
      if (c.name) setCfgName(c.name)
    }).catch(() => {})

    api.get('/groups').then(r => {
      const gs = r.data || []
      setGroups(gs)
      const init = {}
      gs.forEach(g => {
        init[g.id] = {
          daily:  g.daily_goal_value  > 0 ? String(g.daily_goal_value)  : '',
          weekly: g.weekly_goal_value > 0 ? String(g.weekly_goal_value) : '',
        }
      })
      setDraft(init)
    }).catch(() => {})
  }, [])

  const setField = (groupId, field, value) => {
    setDraft(prev => ({ ...prev, [groupId]: { ...prev[groupId], [field]: value } }))
  }

  const savePeriod = async () => {
    if (!cfgStart || !cfgEnd) { showToast('Preencha as datas'); return }
    if (cfgEnd <= cfgStart) { showToast('Data fim deve ser após o início'); return }
    setSavingPeriod(true)
    try {
      const r = await api.put('/settings/campaign', { name: cfgName, start_date: cfgStart, end_date: cfgEnd })
      setCfgStart(toDateInput(r.data.start_date))
      setCfgEnd(toDateInput(r.data.end_date))
      showToast('Período salvo!')
    } catch (e) {
      showToast('Erro: ' + (e.response?.data?.error || e.message))
    } finally {
      setSavingPeriod(false)
    }
  }

  const saveGoals = async () => {
    const goals = groups.map(g => ({
      group_id:          g.id,
      daily_goal_value:  parseFloat(draft[g.id]?.daily  || '0') || 0,
      weekly_goal_value: parseFloat(draft[g.id]?.weekly || '0') || 0,
    }))
    setSavingGoals(true)
    try {
      await api.put('/settings/group-goals', { goals })
      setGroups(prev => prev.map(g => ({
        ...g,
        daily_goal_value:  parseFloat(draft[g.id]?.daily  || '0') || 0,
        weekly_goal_value: parseFloat(draft[g.id]?.weekly || '0') || 0,
      })))
      showToast('Metas salvas!')
    } catch (e) {
      showToast('Erro: ' + (e.response?.data?.error || e.message))
    } finally {
      setSavingGoals(false)
    }
  }

  return (
    <div className="pw">
      <div className="cfg-info-banner">
        <div className="cfg-info-icon">🤖</div>
        <div className="cfg-info-text">
          <strong>Sincronização automática via NewCorban.</strong> Os dados de vendas são atualizados automaticamente. Configure aqui o <strong>período</strong> da campanha e a <strong>meta de valor referência por equipe</strong> (R$) — quando atingida, a equipe ganha pontos.
        </div>
      </div>

      {/* ── Período ── */}
      <div className="sec-label">📅 Período da Campanha</div>
      <div className="card cfg-2col" style={{ marginBottom: 8 }}>
        <div className="field-group">
          <label className="field-label">Data de início</label>
          <input type="date" className="field-input" value={cfgStart} onChange={e => setCfgStart(e.target.value)} />
          <span className="field-hint">Primeiro dia contabilizado no ranking</span>
        </div>
        <div className="field-group">
          <label className="field-label">Data de encerramento</label>
          <input type="date" className="field-input" value={cfgEnd} onChange={e => setCfgEnd(e.target.value)} />
          <span className="field-hint">Último dia da campanha Copa GD</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <button className="btn btn-gold" onClick={savePeriod} disabled={savingPeriod}>
          💾 {savingPeriod ? 'Salvando…' : 'Salvar período'}
        </button>
      </div>

      {/* ── Metas por equipe ── */}
      <div className="sec-label">🎯 Metas de Valor Referência por Equipe (R$)</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
        {groups.length === 0
          ? (
            <div style={{ textAlign: 'center', padding: 24, opacity: .4 }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>👤</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--txt3)' }}>
                Nenhum grupo cadastrado
              </div>
            </div>
          )
          : (
            <table className="sync-table">
              <thead>
                <tr>
                  <th>Equipe</th>
                  <th style={{ textAlign: 'center' }}>Membros</th>
                  <th style={{ textAlign: 'right', minWidth: 160 }}>
                    Meta Diária (R$)
                    <div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>5 pts se atingida</div>
                  </th>
                  <th style={{ textAlign: 'right', minWidth: 160 }}>
                    Meta Semanal (R$)
                    <div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>10 pts se atingida</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="s-av">
                          {g.photo_url ? <img src={g.photo_url} alt="" /> : ini(g.name)}
                        </div>
                        <div>
                          <div className="s-name">{g.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                            Atual diária: <strong style={{ color: 'var(--txt2)' }}>{fBRL(g.daily_goal_value)}</strong>
                            {' · '}
                            Semanal: <strong style={{ color: 'var(--txt2)' }}>{fBRL(g.weekly_goal_value)}</strong>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="s-val">{g.member_count ?? '—'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number" min="0" step="1000"
                        className="field-input"
                        style={{ width: 140, textAlign: 'right', padding: '6px 10px', fontSize: 13 }}
                        placeholder="ex: 10000"
                        value={draft[g.id]?.daily ?? ''}
                        onChange={e => setField(g.id, 'daily', e.target.value)}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number" min="0" step="1000"
                        className="field-input"
                        style={{ width: 140, textAlign: 'right', padding: '6px 10px', fontSize: 13 }}
                        placeholder="ex: 60000"
                        value={draft[g.id]?.weekly ?? ''}
                        onChange={e => setField(g.id, 'weekly', e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      {groups.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
          <button className="btn btn-gold" onClick={saveGoals} disabled={savingGoals}>
            💾 {savingGoals ? 'Salvando…' : 'Salvar metas'}
          </button>
        </div>
      )}
    </div>
  )
}
