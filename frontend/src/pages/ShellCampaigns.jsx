import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import CampaignBoard from './CampaignBoard'

const STATUS = {
  draft:  { label: 'Rascunho', color: 'var(--txt3)' },
  active: { label: 'Ativa',    color: '#059669' },
  closed: { label: 'Encerrada', color: 'var(--txt3)' },
}

const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function CampaignRow({ c, isAdmin, onChanged, onOpen }) {
  const [start, setStart] = useState(c.start_date || '')
  const [end, setEnd] = useState(c.end_date || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async (patch) => {
    setSaving(true); setMsg('')
    try {
      await api.put(`/campaigns/${c.id}`, patch)
      setMsg('salvo')
      onChanged?.()
    } catch (err) {
      setMsg(err.response?.data?.error || 'erro ao salvar')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 2500)
    }
  }

  const st = STATUS[c.status] || STATUS.draft
  const ladder = Array.isArray(c.ladder) ? c.ladder : []

  return (
    <div className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 17 }}>{c.name}</strong>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: st.color }}>
              {st.label}
            </span>
          </div>
          {c.subtitle ? (
            <div style={{ fontSize: 13, color: 'var(--txt2)', marginTop: 4 }}>{c.subtitle}</div>
          ) : null}

          {ladder.length ? (
            <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 8 }}>
              Escada:{' '}
              {ladder.map((t, i) => (
                <span key={t.at}>{i > 0 ? ' · ' : ''}{t.at} → {fmtBRL(t.prize)}</span>
              ))}
              {c.ladder_step ? ` · depois +${fmtBRL(c.ladder_step.prize)} a cada ${c.ladder_step.every}` : ''}
              {c.spin_every ? ` · 1 giro a cada ${c.spin_every}` : ''}
            </div>
          ) : null}

          <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 6 }}>
            Produto {(c.product_ids || []).join(', ') || '—'}
            {c.require_same_day ? ' · digitado e pago no mesmo dia' : ''}
          </div>
        </div>

        <button className="tv-btn" data-color={c.color || 'azul'} onClick={() => onOpen(c.id)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="4" width="20" height="14" />
            <path d="M8 21h8M12 18v3" />
          </svg>
          Abrir na TV
        </button>
      </div>

      {isAdmin ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <label className="field-group" style={{ margin: 0 }}>
            <span className="field-label">Início</span>
            <input type="date" className="field-input" value={start} onChange={e => setStart(e.target.value)} />
          </label>
          <label className="field-group" style={{ margin: 0 }}>
            <span className="field-label">Fim</span>
            <input type="date" className="field-input" value={end} onChange={e => setEnd(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={saving}
            onClick={() => save({ start_date: start || null, end_date: end || null })}
          >
            Salvar datas
          </button>

          {c.status !== 'active' ? (
            <button className="btn" disabled={saving} onClick={() => save({ status: 'active' })}>Ativar</button>
          ) : (
            <button className="btn" disabled={saving} onClick={() => save({ status: 'closed' })}>Encerrar</button>
          )}

          {msg ? <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{msg}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export default function ShellCampaigns() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [list, setList] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [boardId, setBoardId] = useState(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/campaigns')
      setList(data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível carregar as campanhas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="pw">
      <div className="sec-label">Campanhas</div>

      {loading ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>Carregando…</div>
      ) : error ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>{error}</div>
      ) : list.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>
          Nenhuma campanha cadastrada ainda.
        </div>
      ) : (
        list.map(c => (
          <CampaignRow
            key={c.id}
            c={c}
            isAdmin={isAdmin}
            onChanged={load}
            onOpen={setBoardId}
          />
        ))
      )}

      {boardId ? <CampaignBoard campaignId={boardId} onClose={() => setBoardId(null)} /> : null}
    </div>
  )
}
