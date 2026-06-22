import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { RefreshCw, Zap } from 'lucide-react'
import Layout from '../components/Layout'
import Leaderboard from '../components/Leaderboard'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

const RULE_LABELS = {
  META_DIA: { label: 'Meta do Dia', icon: '🎯' },
  META_SEMANA: { label: 'Meta da Semana', icon: '📅' },
  INDICACAO: { label: 'Indicações', icon: '👥' },
  CONTRATO_10K: { label: 'Contrato +10K', icon: '💰' },
  GOL_DE_PLACA: { label: 'Gol de Placa', icon: '⚽' },
  TORCIDA_ORGANIZADA: { label: 'Torcida Organizada', icon: '🎉' },
  ARTILHEIRO: { label: 'Artilheiro', icon: '🏆' },
}

export default function Dashboard() {
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [todayEvents, setTodayEvents] = useState([])
  const [nextMatch, setNextMatch] = useState(null)
  const [todayMatch, setTodayMatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)

  const loadData = async () => {
    try {
      const [groupsRes, eventsRes, nextMatchRes, todayMatchRes] = await Promise.all([
        api.get('/scores/leaderboard'),
        api.get('/scores/today-events'),
        api.get('/worldcup/next'),
        api.get('/worldcup/today'),
      ])
      setGroups(groupsRes.data)
      setTodayEvents(eventsRes.data)
      setNextMatch(nextMatchRes.data)
      setTodayMatch(todayMatchRes.data)
      setLastUpdate(new Date())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60000) // atualizar a cada 1 min
    return () => clearInterval(interval)
  }, [])

  const today = format(new Date(), "EEEE, dd 'de' MMMM", { locale: ptBR })

  return (
    <Layout>
      {/* Banner jogo do Brasil */}
      {todayMatch && (
        <div className="match-day-banner rounded-xl p-4 mb-6 flex items-center gap-3 text-white">
          <span className="text-3xl">🇧🇷</span>
          <div>
            <p className="font-black text-lg">DIA DE JOGO DO BRASIL! 🏆</p>
            <p className="text-white/80 text-sm">
              Brasil x {todayMatch.opponent} • TODOS OS PONTOS SÃO DOBRADOS HOJE!
            </p>
          </div>
          <span className="ml-auto text-3xl font-black text-copa-yellow">2x</span>
        </div>
      )}

      {/* Próximo jogo */}
      {nextMatch && !todayMatch && (
        <div className="card border-copa-blue/40 bg-copa-blue/10 mb-6 flex items-center gap-3">
          <span className="text-2xl">🇧🇷</span>
          <div>
            <p className="text-copa-yellow font-bold text-sm">PRÓXIMO JOGO DO BRASIL</p>
            <p className="text-white font-semibold">
              Brasil x {nextMatch.opponent} —{' '}
              {format(new Date(nextMatch.match_date + 'T12:00:00'), "dd 'de' MMMM", { locale: ptBR })}
            </p>
            <p className="text-white/50 text-xs">Pontos em dobro neste dia!</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-white">
            <span className="text-copa-yellow">Placar</span> Geral
          </h1>
          <p className="text-white/40 text-sm capitalize">{today}</p>
        </div>
        <button onClick={loadData} className="btn-ghost flex items-center gap-2 text-sm py-2 px-3">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2">
          <Leaderboard groups={groups} loading={loading} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Card de boas-vindas */}
          <div className="card bg-brazil-gradient border-copa-green/20">
            <p className="text-white/60 text-sm">Bem-vindo,</p>
            <p className="text-white font-bold text-lg">{user?.display_name}</p>
            {user?.group && (
              <div className="mt-2 pt-2 border-t border-white/10">
                <p className="text-white/50 text-xs">Seu grupo</p>
                <p className="text-copa-green font-semibold">{user.group.name}</p>
              </div>
            )}
          </div>

          {/* Eventos de hoje */}
          {todayEvents.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={16} className="text-copa-yellow" />
                <h3 className="font-bold text-white text-sm">Pontos de Hoje</h3>
              </div>
              <div className="space-y-2">
                {todayEvents.slice(0, 8).map(event => {
                  const rule = RULE_LABELS[event.rule_name] || { label: event.rule_name, icon: '📌' }
                  return (
                    <div key={event.id} className="flex items-center gap-2 text-sm">
                      <span className="text-base">{rule.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-white/80 truncate block text-xs">{event.group_name}</span>
                        <span className="text-white/40 text-xs">{rule.label}</span>
                      </div>
                      <span className="text-copa-green font-bold text-sm flex-shrink-0">+{event.points}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Atualização */}
          {lastUpdate && (
            <p className="text-white/20 text-xs text-center">
              Atualizado às {format(lastUpdate, 'HH:mm')}
            </p>
          )}
        </div>
      </div>
    </Layout>
  )
}
