import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Users, Trophy, Star, Calendar, Play, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import Leaderboard from '../../components/Leaderboard'
import api from '../../api/client'

export default function AdminDashboard() {
  const [groups, setGroups] = useState([])
  const [stats, setStats] = useState({ users: 0, groups: 0, events_today: 0 })
  const [todayMatch, setTodayMatch] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const [groupsRes, usersRes, eventsRes, todayMatchRes] = await Promise.all([
        api.get('/scores/leaderboard'),
        api.get('/admin/users'),
        api.get('/scores/today-events'),
        api.get('/worldcup/today'),
      ])
      setGroups(groupsRes.data)
      setStats({
        users: usersRes.data.filter(u => u.role === 'player').length,
        groups: groupsRes.data.length,
        events_today: eventsRes.data.length,
      })
      setTodayMatch(todayMatchRes.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const handleCalculate = async () => {
    setCalculating(true)
    try {
      const { data } = await api.post('/scores/calculate', {})
      toast.success(`✅ ${data.events_count} eventos gerados para hoje!`)
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao calcular pontuações')
    } finally {
      setCalculating(false)
    }
  }

  const quickLinks = [
    { to: '/admin/users', icon: <Users size={20} />, label: 'Gerenciar Jogadores', color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { to: '/admin/groups', icon: <Trophy size={20} />, label: 'Gerenciar Grupos', color: 'text-copa-green', bg: 'bg-copa-green/10' },
    { to: '/admin/scores', icon: <Star size={20} />, label: 'Ajustar Pontuação', color: 'text-copa-yellow', bg: 'bg-copa-yellow/10' },
    { to: '/admin/worldcup', icon: <Calendar size={20} />, label: 'Calendário Copa', color: 'text-red-400', bg: 'bg-red-500/10' },
  ]

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Painel <span className="text-copa-yellow">Admin</span>
          </h1>
          <p className="text-white/40 text-sm">Copa GD 2026</p>
        </div>
        <button
          onClick={handleCalculate}
          disabled={calculating}
          className="btn-primary flex items-center gap-2"
        >
          {calculating ? (
            <span className="animate-spin">⚽</span>
          ) : (
            <Play size={16} />
          )}
          {calculating ? 'Calculando...' : 'Calcular Pontuações'}
        </button>
      </div>

      {todayMatch && (
        <div className="match-day-banner rounded-xl p-4 mb-6 text-white flex items-center gap-3">
          <span className="text-3xl">🇧🇷</span>
          <div>
            <p className="font-black">DIA DE JOGO! Pontos em dobro.</p>
            <p className="text-white/80 text-sm">Brasil x {todayMatch.opponent}</p>
          </div>
          <span className="ml-auto text-copa-yellow font-black text-2xl">2x</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <div className="text-3xl font-black text-copa-green">{stats.users}</div>
          <div className="text-white/50 text-sm">Jogadores</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-copa-yellow">{stats.groups}</div>
          <div className="text-white/50 text-sm">Grupos</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-black text-blue-400">{stats.events_today}</div>
          <div className="text-white/50 text-sm">Eventos Hoje</div>
        </div>
      </div>

      {/* Links rápidos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {quickLinks.map(link => (
          <Link
            key={link.to}
            to={link.to}
            className={`card ${link.bg} border-transparent hover:border-white/20 transition-all flex items-center gap-3`}
          >
            <span className={link.color}>{link.icon}</span>
            <span className="text-white font-medium text-sm">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Placar */}
      <h2 className="text-lg font-bold text-white mb-3">Placar Atual</h2>
      <Leaderboard groups={groups} loading={loading} />
    </Layout>
  )
}
