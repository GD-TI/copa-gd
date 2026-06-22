import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import ShellAdminTeams from '../components/ShellAdminTeams'

function showToast(msg, ok = true) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
    background: ok ? 'var(--txt)' : '#ef4444', color: ok ? 'var(--surf)' : '#fff',
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

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// ── Seção de Ajustes de Pontos ──────────────────────────────────────────────
function PointAdjustments({ groups }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [adjustments, setAdjustments]     = useState([])
  const [loadingAdj, setLoadingAdj]       = useState(false)
  const [points, setPoints]               = useState('')
  const [reason, setReason]               = useState('')
  const [saving, setSaving]               = useState(false)
  const [deletingId, setDeletingId]       = useState(null)

  const loadAdjustments = useCallback((groupId) => {
    if (!groupId) { setAdjustments([]); return }
    setLoadingAdj(true)
    api.get(`/admin/groups/${groupId}/points`)
      .then(r => setAdjustments(r.data || []))
      .catch(() => setAdjustments([]))
      .finally(() => setLoadingAdj(false))
  }, [])

  useEffect(() => { loadAdjustments(selectedGroup) }, [selectedGroup, loadAdjustments])

  // Pré-selecionar primeiro grupo
  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) setSelectedGroup(String(groups[0].id))
  }, [groups, selectedGroup])

  const handleAdd = async (e) => {
    e.preventDefault()
    const pts = parseFloat(points)
    if (!pts || pts === 0) { showToast('Informe os pontos (positivo ou negativo)', false); return }
    if (!reason.trim()) { showToast('Informe a justificativa', false); return }
    setSaving(true)
    try {
      await api.post(`/admin/groups/${selectedGroup}/points`, { points: pts, reason: reason.trim() })
      showToast(`${pts > 0 ? '+' : ''}${pts} pts aplicado!`)
      setPoints('')
      setReason('')
      loadAdjustments(selectedGroup)
    } catch (err) {
      showToast(err.response?.data?.error || 'Erro ao salvar ajuste', false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Remover este ajuste?')) return
    setDeletingId(id)
    try {
      await api.delete(`/admin/adjustments/${id}`)
      showToast('Ajuste removido')
      setAdjustments(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      showToast(err.response?.data?.error || 'Erro ao remover', false)
    } finally {
      setDeletingId(null)
    }
  }

  const total = adjustments.reduce((s, a) => s + Number(a.points), 0)

  return (
    <div>
      {/* Seletor de equipe */}
      <div style={{ marginBottom: 16 }}>
        <label className="field-label" style={{ marginBottom: 6, display: 'block' }}>Equipe</label>
        <select
          className="field-input"
          style={{ maxWidth: 320 }}
          value={selectedGroup}
          onChange={e => setSelectedGroup(e.target.value)}
        >
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {/* Formulário de novo ajuste */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>
          Novo Ajuste
        </div>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field-group" style={{ flex: '0 0 130px' }}>
              <label className="field-label">Pontos</label>
              <input
                type="number"
                className="field-input"
                style={{ textAlign: 'right' }}
                placeholder="ex: -10 ou +15"
                value={points}
                onChange={e => setPoints(e.target.value)}
              />
              <span className="field-hint">Negativo = penalidade</span>
            </div>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <label className="field-label">Justificativa</label>
              <input
                type="text"
                className="field-input"
                placeholder="ex: Cartão amarelo, Bônus especial…"
                maxLength={200}
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-gold"
              disabled={saving || !points || !reason.trim()}
              style={{ flexShrink: 0, marginBottom: 2 }}
            >
              {saving ? 'Salvando…' : '✅ Aplicar'}
            </button>
          </div>
        </form>
      </div>

      {/* Lista de ajustes existentes */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase' }}>
            Histórico de Ajustes
          </div>
          {adjustments.length > 0 && (
            <div style={{ font: '700 12px/1 var(--mono)', color: total >= 0 ? 'var(--green)' : 'var(--red)' }}>
              Total: {total >= 0 ? '+' : ''}{total} pts
            </div>
          )}
        </div>

        {loadingAdj && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>Carregando…</div>
        )}

        {!loadingAdj && adjustments.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--txt3)', fontSize: 13, opacity: .6 }}>
            Nenhum ajuste registrado para esta equipe
          </div>
        )}

        {!loadingAdj && adjustments.map(a => {
          const pts = Number(a.points)
          const isPos = pts >= 0
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 18px', borderBottom: '1px solid var(--border)',
            }}>
              {/* Badge de pontos */}
              <div style={{
                flexShrink: 0, width: 52, textAlign: 'center',
                font: '700 13px/1 var(--mono)',
                color: isPos ? 'var(--green)' : 'var(--red)',
                background: isPos ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
                border: `1px solid ${isPos ? 'rgba(34,197,94,.25)' : 'rgba(239,68,68,.25)'}`,
                borderRadius: 6, padding: '4px 0',
              }}>
                {isPos ? '+' : ''}{pts}
              </div>
              {/* Justificativa + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '600 13px/1 var(--font)', color: 'var(--txt)', marginBottom: 2 }}>
                  {a.reason}
                </div>
                <div style={{ font: '400 10px/1 var(--font)', color: 'var(--txt3)' }}>
                  {fmtDate(a.adjustment_date)}{a.admin_name ? ` · por ${a.admin_name}` : ''}
                </div>
              </div>
              {/* Remover */}
              <button
                onClick={() => handleDelete(a.id)}
                disabled={deletingId === a.id}
                style={{
                  background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                  color: 'var(--txt3)', borderRadius: 6, padding: '4px 8px', fontSize: 11,
                  flexShrink: 0, transition: 'color .15s, border-color .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                {deletingId === a.id ? '…' : '✕'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Recálculo manual da campanha ────────────────────────────────────────────
function RecalculateCampaign() {
  const [busy, setBusy] = useState(false)

  const handleRecalculate = async () => {
    if (!window.confirm(
      'Recalcular TODOS os dias da campanha com as regras e equipes atuais?\n\n' +
      'Isso pode levar alguns minutos. Os pontos históricos serão atualizados.'
    )) return

    setBusy(true)
    try {
      const { data } = await api.post('/scores/calculate', {}, { timeout: 180000 })
      const n = data?.events_count ?? 0
      showToast(`Recálculo concluído! ${n} evento(s) diário(s) processado(s).`)
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao recalcular pontuações', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 28, padding: '16px 18px' }}>
      <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>
        Recálculo de Pontuação
      </div>
      <p style={{ font: '400 12px/1.5 var(--font)', color: 'var(--txt2)', margin: '0 0 14px' }}>
        Reprocessa <strong>todos os dias</strong> da campanha (propostas NewCorban + regras atuais).
        Use após mudar equipes, metas ou pontos das regras.
      </p>
      <button type="button" className="btn btn-gold" onClick={handleRecalculate} disabled={busy}>
        {busy ? '⏳ Recalculando…' : '🔄 Recalcular toda a campanha'}
      </button>
    </div>
  )
}

// ── Pontos por regra ────────────────────────────────────────────────────────
function ScoringRulesConfig() {
  const [rules, setRules] = useState([])
  const [draft, setDraft] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/settings/scoring-rules')
      .then(r => {
        const rs = r.data || []
        setRules(rs)
        const init = {}
        rs.forEach(rule => { init[rule.name] = String(rule.points) })
        setDraft(init)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    const payload = rules.map(r => ({
      rule_name: r.name,
      base_points: parseFloat(draft[r.name] || '0') || 0,
    }))
    setSaving(true)
    try {
      await api.put('/settings/scoring-rules', { rules: payload })
      showToast('Pontos das regras salvos!')
    } catch (e) {
      showToast('Erro: ' + (e.response?.data?.error || e.message), false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="card" style={{ padding: 24, color: 'var(--txt3)', fontSize: 13 }}>Carregando regras…</div>

  return (
    <div>
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
        <table className="sync-table">
          <thead>
            <tr>
              <th>Regra</th>
              <th style={{ textAlign: 'right', minWidth: 120 }}>Pontos base</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.name}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{r.icon}</span>
                    <div>
                      <div className="s-name">{r.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{r.description}</div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    type="number" min="0" step="1"
                    className="field-input"
                    style={{ width: 90, textAlign: 'right', padding: '6px 10px', fontSize: 13 }}
                    value={draft[r.name] ?? ''}
                    onChange={e => setDraft(prev => ({ ...prev, [r.name]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <button className="btn btn-gold" onClick={save} disabled={saving}>
          💾 {saving ? 'Salvando…' : 'Salvar pontos das regras'}
        </button>
      </div>
      <p style={{ font: '400 11px/1.4 var(--font)', color: 'var(--txt3)', marginTop: -16, marginBottom: 28 }}>
        Em dias de jogo do Brasil, os pontos são multiplicados por 2. Indicação e Contrato 10K usam o valor por lote/contrato.
      </p>
    </div>
  )
}

export default function ShellConfig() {
  const [cfgStart, setCfgStart] = useState('')
  const [cfgEnd, setCfgEnd]     = useState('')
  const [cfgName, setCfgName]   = useState('Copa GD 2026')
  const [groups, setGroups]     = useState([])
  const [draft, setDraft]       = useState({})
  const [savingPeriod, setSavingPeriod] = useState(false)
  const [savingGoals, setSavingGoals]   = useState(false)

  const loadGroups = useCallback(() => {
    api.get('/groups').then(r => {
      const gs = r.data || []
      setGroups(gs)
      const init = {}
      gs.forEach(g => {
        init[g.id] = {
          daily:  g.daily_goal_value  > 0 ? String(g.daily_goal_value)  : '',
          weekly: g.weekly_goal_value > 0 ? String(g.weekly_goal_value) : '',
          goal:   g.goal_points       > 0 ? String(g.goal_points)       : '',
        }
      })
      setDraft(init)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.get('/settings/campaign').then(r => {
      const c = r.data
      setCfgStart(toDateInput(c.start_date))
      setCfgEnd(toDateInput(c.end_date))
      if (c.name) setCfgName(c.name)
    }).catch(() => {})

    loadGroups()
  }, [loadGroups])

  const setField = (groupId, field, value) => {
    setDraft(prev => ({ ...prev, [groupId]: { ...prev[groupId], [field]: value } }))
  }

  const savePeriod = async () => {
    if (!cfgStart || !cfgEnd) { showToast('Preencha as datas', false); return }
    if (cfgEnd <= cfgStart) { showToast('Data fim deve ser após o início', false); return }
    setSavingPeriod(true)
    try {
      const r = await api.put('/settings/campaign', { name: cfgName, start_date: cfgStart, end_date: cfgEnd })
      setCfgStart(toDateInput(r.data.start_date))
      setCfgEnd(toDateInput(r.data.end_date))
      showToast('Período salvo!')
    } catch (e) {
      showToast('Erro: ' + (e.response?.data?.error || e.message), false)
    } finally {
      setSavingPeriod(false)
    }
  }

  const saveGoals = async () => {
    const goals = groups.map(g => ({
      group_id:          g.id,
      daily_goal_value:  parseFloat(draft[g.id]?.daily  || '0') || 0,
      weekly_goal_value: parseFloat(draft[g.id]?.weekly || '0') || 0,
      goal_points:       parseInt(draft[g.id]?.goal   || '0') || 0,
    }))
    setSavingGoals(true)
    try {
      await api.put('/settings/group-goals', { goals })
      setGroups(prev => prev.map(g => ({
        ...g,
        daily_goal_value:  parseFloat(draft[g.id]?.daily  || '0') || 0,
        weekly_goal_value: parseFloat(draft[g.id]?.weekly || '0') || 0,
        goal_points:       parseInt(draft[g.id]?.goal   || '0') || 0,
      })))
      showToast('Metas salvas!')
    } catch (e) {
      showToast('Erro: ' + (e.response?.data?.error || e.message), false)
    } finally {
      setSavingGoals(false)
    }
  }

  return (
    <div className="pw">
      <div className="cfg-info-banner">
        <div className="cfg-info-icon">🤖</div>
        <div className="cfg-info-text">
          <strong>Painel administrativo.</strong> Gerencie equipes e jogadores, configure metas por equipe (R$), pontos das regras e período da campanha. Os dados de vendas vêm do NewCorban automaticamente.
        </div>
      </div>

      {/* ── Equipes e jogadores ── */}
      <div className="sec-label">⚽ Equipes e Jogadores</div>
      <ShellAdminTeams groups={groups} onRefresh={loadGroups} />

      {/* ── Pontos das regras ── */}
      <div className="sec-label">🏅 Pontos por Regra</div>
      <ScoringRulesConfig />
      <RecalculateCampaign />

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
                  </th>
                  <th style={{ textAlign: 'right', minWidth: 160 }}>
                    Meta Semanal (R$)
                  </th>
                  <th style={{ textAlign: 'right', minWidth: 140 }}>
                    Meta de Pontos
                    <div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>barra de progresso</div>
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
                    <td style={{ textAlign: 'right' }}>
                      <input
                        type="number" min="0" step="10"
                        className="field-input"
                        style={{ width: 120, textAlign: 'right', padding: '6px 10px', fontSize: 13 }}
                        placeholder="ex: 500"
                        value={draft[g.id]?.goal ?? ''}
                        onChange={e => setField(g.id, 'goal', e.target.value)}
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

      {/* ── Ajustes manuais de pontos ── */}
      {groups.length > 0 && (
        <>
          <div className="sec-label">⚖️ Ajuste Manual de Pontos</div>
          <PointAdjustments groups={groups} />
        </>
      )}
    </div>
  )
}
