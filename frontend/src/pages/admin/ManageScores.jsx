import { useState, useEffect } from 'react'
import { Play, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Layout from '../../components/Layout'
import ScoreEvents from '../../components/ScoreEvents'
import api from '../../api/client'

const RULE_INFO = {
  META_DIA: { label: 'Meta do Dia', points: '5 pts', icon: '🎯', desc: 'Grupo atinge meta diária de propostas' },
  META_SEMANA: { label: 'Meta da Semana', points: '10 pts', icon: '📅', desc: 'Grupo atinge meta semanal (1x por semana)' },
  INDICACAO: { label: 'Vendas por Indicação', points: '10 pts / 5 contratos', icon: '👥', desc: 'A cada 5 contratos pagos de indicação' },
  CONTRATO_10K: { label: 'Contrato +10K', points: '5 pts / contrato', icon: '💰', desc: 'Contrato com valor_referencia > R$ 10.000' },
  GOL_DE_PLACA: { label: 'Gol de Placa', points: '15 pts', icon: '⚽', desc: 'Grupo com maior contrato individual do dia' },
  TORCIDA_ORGANIZADA: { label: 'Torcida Organizada', points: '20 pts', icon: '🎉', desc: 'Todos os 5 membros com +10 propostas no dia' },
  ARTILHEIRO: { label: 'Artilheiro da Rodada', points: '15 pts', icon: '🏆', desc: 'Grupo com maior nº de contratos pagos no dia' },
}

export default function ManageScores() {
  const [todayEvents, setTodayEvents] = useState([])
  const [calculating, setCalculating] = useState(false)
  const [calcDate, setCalcDate] = useState(new Date().toISOString().split('T')[0])
  const [lastResult, setLastResult] = useState(null)

  const loadTodayEvents = async () => {
    try {
      const { data } = await api.get('/scores/today-events')
      setTodayEvents(data)
    } catch (err) { console.error(err) }
  }

  useEffect(() => { loadTodayEvents() }, [])

  const handleCalculate = async () => {
    setCalculating(true)
    setLastResult(null)
    try {
      const { data } = await api.post('/scores/calculate', { date: calcDate })
      toast.success(`✅ ${data.events_count} eventos gerados!`)
      setLastResult(data)
      loadTodayEvents()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao calcular')
    } finally {
      setCalculating(false)
    }
  }

  return (
    <Layout>
      <h1 className="text-2xl font-black text-white mb-6">Pontuação</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Calcular */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-bold text-white mb-4 flex items-center gap-2">
              <Play size={16} className="text-copa-green" />
              Calcular Pontuações
            </h2>
            <p className="text-white/50 text-sm mb-4">
              Busca os dados do NewCorban e aplica as regras para a data selecionada.
              Pode ser executado várias vezes (idempotente).
            </p>
            <div className="mb-4">
              <label className="label">Data</label>
              <input type="date" value={calcDate} onChange={e => setCalcDate(e.target.value)} className="input-field" />
            </div>
            <button onClick={handleCalculate} disabled={calculating} className="btn-primary w-full flex items-center justify-center gap-2">
              {calculating ? <span className="animate-spin">⚽</span> : <Play size={16} />}
              {calculating ? 'Calculando...' : 'Executar Cálculo'}
            </button>

            {lastResult && (
              <div className="mt-4 p-3 bg-copa-green/10 border border-copa-green/20 rounded-lg">
                <p className="text-copa-green font-semibold text-sm">
                  ✅ {lastResult.events_count} eventos gerados para {lastResult.date}
                </p>
                {lastResult.events?.slice(0, 5).map((ev, i) => (
                  <p key={i} className="text-white/60 text-xs mt-1">
                    +{ev.points} pts — Grupo {ev.group_id} ({ev.rule_name})
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Regras */}
          <div className="card">
            <h2 className="font-bold text-white mb-4 flex items-center gap-2">
              <Info size={16} className="text-copa-yellow" />
              Regras de Pontuação
            </h2>
            <div className="space-y-2">
              {Object.entries(RULE_INFO).map(([key, rule]) => (
                <div key={key} className="flex items-start gap-3 p-2 rounded-lg bg-copa-navy">
                  <span className="text-lg flex-shrink-0">{rule.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium text-sm">{rule.label}</span>
                      <span className="badge-yellow">{rule.points}</span>
                    </div>
                    <p className="text-white/40 text-xs mt-0.5">{rule.desc}</p>
                  </div>
                </div>
              ))}
              <p className="text-white/30 text-xs text-center mt-2">
                🇧🇷 Em dias de jogo do Brasil, todos os pontos são multiplicados por 2
              </p>
            </div>
          </div>
        </div>

        {/* Eventos de hoje */}
        <div>
          <ScoreEvents
            events={todayEvents.map(e => ({
              ...e,
              description: `${e.group_name} — ${e.description}`,
            }))}
            title={`Eventos de Hoje (${format(new Date(), "dd/MM", { locale: ptBR })})`}
          />
        </div>
      </div>
    </Layout>
  )
}
