import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Target, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import api from '../../api/client'

function GoalsModal({ group, onClose, onSave }) {
  const [form, setForm] = useState({
    daily_goal: group.daily_goal || 0,
    weekly_goal: group.weekly_goal || 0,
    valid_from: new Date().toISOString().split('T')[0],
    valid_until: '',
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put(`/admin/groups/${group.id}/goals`, form)
      toast.success('Metas definidas!')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar metas')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm border-white/20">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Definir Metas — {group.name}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Meta Diária (propostas)</label>
            <input type="number" min="0" value={form.daily_goal} onChange={e => setForm(f => ({ ...f, daily_goal: e.target.value }))} className="input-field" />
          </div>
          <div>
            <label className="label">Meta Semanal (propostas)</label>
            <input type="number" min="0" value={form.weekly_goal} onChange={e => setForm(f => ({ ...f, weekly_goal: e.target.value }))} className="input-field" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Válido a partir de</label>
              <input type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="label">Válido até</label>
              <input type="date" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Salvando...' : 'Salvar Metas'}</button>
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PointsModal({ group, onClose, onSave }) {
  const [form, setForm] = useState({ points: '', reason: '' })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.reason.trim()) return
    setSaving(true)
    try {
      await api.post(`/admin/groups/${group.id}/points`, form)
      toast.success('Pontos ajustados!')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao ajustar pontos')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm border-white/20">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Ajuste de Pontos — {group.name}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Pontos (use negativo para remover)</label>
            <input type="number" value={form.points} onChange={e => setForm(f => ({ ...f, points: e.target.value }))} className="input-field" placeholder="Ex: 10 ou -5" required />
          </div>
          <div>
            <label className="label">Motivo *</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="input-field h-20 resize-none" placeholder="Descreva o motivo do ajuste..." required />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || !form.points || !form.reason.trim()} className="btn-primary flex-1">{saving ? 'Salvando...' : 'Confirmar'}</button>
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ManageGroups() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | {type: 'goals'|'points', data}

  const loadData = async () => {
    try {
      const { data } = await api.get('/admin/groups')
      setGroups(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [])

  const handleDeactivate = async (group) => {
    if (!confirm(`Desativar o grupo "${group.name}"?`)) return
    try {
      await api.delete(`/admin/groups/${group.id}`)
      toast.success('Grupo desativado')
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro')
    }
  }

  return (
    <Layout>
      {modal?.type === 'goals' && (
        <GoalsModal group={modal.data} onClose={() => setModal(null)} onSave={() => { setModal(null); loadData() }} />
      )}
      {modal?.type === 'points' && (
        <PointsModal group={modal.data} onClose={() => setModal(null)} onSave={() => { setModal(null); loadData() }} />
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-black text-white">Grupos</h1>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-20" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => (
            <div key={group.id} className="card">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-copa-blue flex-shrink-0">
                  {group.photo_url ? (
                    <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl">⚽</div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Link to={`/groups/${group.id}`} className="text-white font-bold hover:text-copa-green transition-colors">
                      {group.name}
                    </Link>
                    <span className="badge-blue">{group.member_count}/5</span>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs text-white/40">
                    {group.daily_goal > 0 && <span>🎯 Meta dia: {group.daily_goal}</span>}
                    {group.weekly_goal > 0 && <span>📅 Meta semana: {group.weekly_goal}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModal({ type: 'goals', data: group })}
                    className="btn-ghost py-1.5 px-3 text-xs flex items-center gap-1"
                    title="Definir metas"
                  >
                    <Target size={13} /> Metas
                  </button>
                  <button
                    onClick={() => setModal({ type: 'points', data: group })}
                    className="btn-yellow py-1.5 px-3 text-xs flex items-center gap-1"
                    title="Ajustar pontos"
                  >
                    <Plus size={13} /> Pontos
                  </button>
                  <button
                    onClick={() => handleDeactivate(group)}
                    className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors"
                    title="Desativar grupo"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}
