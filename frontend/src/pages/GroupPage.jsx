import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Users, ArrowLeft, Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Layout from '../components/Layout'
import ScoreEvents from '../components/ScoreEvents'
import api from '../api/client'

export default function GroupPage() {
  const { id } = useParams()
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/groups/${id}`)
      .then(res => setGroup(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-4xl animate-bounce">⚽</div>
        </div>
      </Layout>
    )
  }

  if (!group) {
    return (
      <Layout>
        <div className="card text-center py-12">
          <p className="text-white/40">Grupo não encontrado</p>
          <Link to="/" className="btn-secondary mt-4 inline-block">Voltar</Link>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <Link to="/" className="flex items-center gap-2 text-white/50 hover:text-white mb-5 transition-colors text-sm">
        <ArrowLeft size={16} /> Voltar ao placar
      </Link>

      {/* Header do grupo */}
      <div className="card bg-brazil-gradient border-copa-green/20 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-copa-blue border-2 border-copa-green flex-shrink-0">
            {group.photo_url ? (
              <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">⚽</div>
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black text-white">{group.name}</h1>
            <div className="flex items-center gap-1 text-white/50 text-sm mt-1">
              <Users size={14} />
              <span>{group.members?.length || 0}/5 jogadores</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-copa-yellow tabular-nums">
              {Number(group.score?.total || 0).toLocaleString('pt-BR')}
            </div>
            <div className="text-white/40 text-xs">pontos totais</div>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center">
          <div className="text-xl font-black text-copa-green">{Number(group.score?.today || 0)}</div>
          <div className="text-white/50 text-xs mt-1">hoje</div>
        </div>
        <div className="card text-center">
          <div className="text-xl font-black text-copa-yellow">{Number(group.score?.week || 0)}</div>
          <div className="text-white/50 text-xs mt-1">semana</div>
        </div>
        <div className="card text-center">
          <div className="text-xl font-black text-white">{group.members?.length || 0}</div>
          <div className="text-white/50 text-xs mt-1">membros</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Membros */}
        <div className="card">
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <Users size={16} className="text-copa-green" />
            Membros
          </h3>
          <div className="space-y-3">
            {group.members?.map(member => (
              <div key={member.id} className="flex items-center gap-3 p-2 rounded-lg bg-copa-navy">
                <div className="w-8 h-8 rounded-full bg-copa-blue flex items-center justify-center text-sm font-bold text-copa-yellow">
                  {(member.display_name || member.username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">
                    {member.display_name || member.username}
                  </p>
                  {member.corban_name && (
                    <p className="text-white/40 text-xs truncate">{member.corban_name}</p>
                  )}
                </div>
                {member.is_captain && (
                  <span className="badge-yellow">Capitão ⭐</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Meta atual */}
        <div>
          {group.goal && (
            <div className="card mb-4">
              <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                <span>🎯</span> Metas
              </h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Meta do Dia</span>
                  <span className="text-copa-yellow font-bold">{group.goal.daily_goal} propostas</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Meta da Semana</span>
                  <span className="text-copa-yellow font-bold">{group.goal.weekly_goal} propostas</span>
                </div>
                {group.goal.valid_until && (
                  <p className="text-white/30 text-xs mt-2">
                    Válido até {format(new Date(group.goal.valid_until + 'T12:00:00'), "dd/MM/yyyy")}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Ajustes de pontos */}
          {group.adjustments?.length > 0 && (
            <div className="card">
              <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                <span>⚙️</span> Ajustes do Admin
              </h3>
              <div className="space-y-2">
                {group.adjustments.map(adj => (
                  <div key={adj.id} className="flex items-center justify-between p-2 bg-copa-navy rounded-lg">
                    <div>
                      <p className="text-white/70 text-xs">{adj.reason}</p>
                      <p className="text-white/30 text-xs">{adj.admin_name}</p>
                    </div>
                    <span className={`font-bold ${adj.points >= 0 ? 'text-copa-green' : 'text-red-400'}`}>
                      {adj.points >= 0 ? '+' : ''}{adj.points}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="mt-6">
        <ScoreEvents events={group.events} title="Histórico de Pontuação" />
      </div>
    </Layout>
  )
}
