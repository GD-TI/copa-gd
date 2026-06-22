import { useState, useEffect } from 'react'
import { Plus, Trash2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import api from '../../api/client'

const STAGE_LABELS = {
  group: 'Fase de Grupos',
  round_of_16: 'Oitavas de Final',
  quarter: 'Quartas de Final',
  semi: 'Semifinal',
  third_place: '3º Lugar',
  final: 'Final',
}

export default function WorldCupCalendar() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ match_date: '', opponent: '', stage: 'group', description: '', double_points: true })
  const [saving, setSaving] = useState(false)

  const loadMatches = async () => {
    try {
      const { data } = await api.get('/worldcup/matches')
      setMatches(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadMatches() }, [])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { data } = await api.post('/worldcup/sync')
      toast.success(`🇧🇷 ${data.count} jogos sincronizados!`)
      loadMatches()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/worldcup/matches', form)
      toast.success('Jogo adicionado!')
      setShowForm(false)
      setForm({ match_date: '', opponent: '', stage: 'group', description: '', double_points: true })
      loadMatches()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao adicionar')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Remover este jogo?')) return
    try {
      await api.delete(`/worldcup/matches/${id}`)
      toast.success('Jogo removido')
      loadMatches()
    } catch (err) {
      toast.error('Erro ao remover')
    }
  }

  const handleToggleDouble = async (match) => {
    try {
      await api.patch(`/worldcup/matches/${match.id}`, { double_points: !match.double_points })
      toast.success(`Pontos dobrados ${!match.double_points ? 'ativados' : 'desativados'}`)
      loadMatches()
    } catch (err) {
      toast.error('Erro')
    }
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            🇧🇷 Calendário da Copa
          </h1>
          <p className="text-white/40 text-sm">Jogos do Brasil com pontos em dobro</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSync} disabled={syncing} className="btn-ghost flex items-center gap-2 text-sm">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sincronizar API
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={14} />
            Adicionar Jogo
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-6 border-copa-blue/30">
          <h3 className="font-bold text-white mb-4">Adicionar Jogo do Brasil</h3>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Data *</label>
                <input type="date" value={form.match_date} onChange={e => setForm(f => ({ ...f, match_date: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="label">Adversário</label>
                <input value={form.opponent} onChange={e => setForm(f => ({ ...f, opponent: e.target.value }))} className="input-field" placeholder="Ex: Argentina" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Fase</label>
                <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))} className="input-field">
                  {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Pontos Dobrados</label>
                <div className="flex items-center gap-2 mt-2.5">
                  <button type="button" onClick={() => setForm(f => ({ ...f, double_points: !f.double_points }))} className={form.double_points ? 'text-copa-green' : 'text-white/30'}>
                    {form.double_points ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                  </button>
                  <span className="text-white/60 text-sm">{form.double_points ? 'Ativo' : 'Inativo'}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Salvando...' : 'Adicionar'}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card animate-pulse h-16" />)}
        </div>
      ) : matches.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🇧🇷</div>
          <p className="text-white/40">Nenhum jogo cadastrado</p>
          <p className="text-white/30 text-sm mt-1">Use "Sincronizar API" ou adicione manualmente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map(match => {
            const matchDate = match.match_date
            const isToday = matchDate === today
            const isPast = matchDate < today

            return (
              <div key={match.id} className={`card flex items-center gap-4 ${isToday ? 'border-copa-yellow/40 bg-copa-yellow/5' : ''}`}>
                <div className={`text-3xl ${isPast ? 'opacity-40' : ''}`}>🇧🇷</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-bold ${isToday ? 'text-copa-yellow' : 'text-white'}`}>
                      Brasil{match.opponent ? ` x ${match.opponent}` : ''}
                    </span>
                    {isToday && <span className="badge-yellow">HOJE!</span>}
                    {isPast && <span className="text-white/30 text-xs">passado</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-white/40 text-xs">
                    <span>{format(new Date(matchDate + 'T12:00:00'), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                    {match.stage && <span>{STAGE_LABELS[match.stage] || match.stage}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleDouble(match)}
                    className={`text-sm flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${match.double_points ? 'text-copa-green bg-copa-green/10' : 'text-white/30 bg-white/5'}`}
                    title={match.double_points ? 'Pontos dobrados ativo' : 'Pontos dobrados inativo'}
                  >
                    {match.double_points ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    <span className="text-xs">2x</span>
                  </button>
                  <button onClick={() => handleDelete(match.id)} className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card mt-6 bg-copa-blue/10 border-copa-blue/20">
        <p className="text-white/60 text-sm">
          <strong className="text-copa-yellow">💡 Sobre a Sincronização Automática:</strong>{' '}
          Configure <code className="bg-white/10 px-1 rounded">FOOTBALL_API_KEY</code> no arquivo <code className="bg-white/10 px-1 rounded">.env</code> com sua chave da{' '}
          <a href="https://www.football-data.org" target="_blank" rel="noopener noreferrer" className="text-copa-green underline">football-data.org</a>{' '}
          (plano gratuito disponível) para sincronizar os jogos do Brasil automaticamente.
        </p>
      </div>
    </Layout>
  )
}
