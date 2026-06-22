import { useState, useEffect } from 'react'
import { Calendar, Save, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'

export default function CampaignSettings() {
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/settings/campaign')
      .then(({ data }) => {
        setForm({
          name: data.name || 'Copa GD 2026',
          start_date: data.start_date?.split('T')[0] || '',
          end_date: data.end_date?.split('T')[0] || '',
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.start_date || !form.end_date) {
      toast.error('Preencha as datas de início e fim')
      return
    }
    if (form.end_date <= form.start_date) {
      toast.error('Data de fim deve ser posterior à data de início')
      return
    }
    setSaving(true)
    try {
      await api.put('/settings/campaign', form)
      toast.success('Campanha salva com sucesso!')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const durationDays = form.start_date && form.end_date
    ? Math.max(0, Math.ceil((new Date(form.end_date) - new Date(form.start_date)) / 86400000))
    : null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Calendar size={22} className="text-copa-yellow" />
        <div>
          <h1 className="text-xl font-bold text-white">Período da Campanha</h1>
          <p className="text-white/40 text-sm">Define o intervalo usado no ranking e no cálculo de pontos</p>
        </div>
      </div>

      <div className="card border border-white/15 space-y-5">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-3 rounded-xl bg-copa-yellow/5 border border-copa-yellow/15">
          <Info size={16} className="text-copa-yellow flex-shrink-0 mt-0.5" />
          <p className="text-white/60 text-xs leading-relaxed">
            O <strong className="text-white/80">período da campanha</strong> é usado para filtrar os pontos exibidos no ranking.
            Somente eventos de pontuação e ajustes dentro desse intervalo são contabilizados.
          </p>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-10 bg-white/10 rounded-xl" />
            <div className="h-10 bg-white/10 rounded-xl" />
            <div className="h-10 bg-white/10 rounded-xl" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="label">Nome da campanha</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input-field"
                placeholder="Ex: Copa GD 2026"
                maxLength={150}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Data de início</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="label">Data de fim</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                  className="input-field"
                />
              </div>
            </div>

            {durationDays !== null && (
              <p className="text-white/40 text-xs">
                Duração: <strong className="text-copa-green">{durationDays} dias</strong>
              </p>
            )}

            <div className="pt-2 border-t border-white/10">
              <button
                type="submit"
                disabled={saving || !form.name.trim() || !form.start_date || !form.end_date}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {saving ? <span className="animate-spin">⚽</span> : <Save size={16} />}
                {saving ? 'Salvando...' : 'Salvar campanha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
