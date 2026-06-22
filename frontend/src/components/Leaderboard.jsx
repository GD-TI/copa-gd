import { Trophy } from 'lucide-react'
import GroupCard from './GroupCard'

export default function Leaderboard({ groups, loading }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="card animate-pulse h-20 bg-copa-card/50" />
        ))}
      </div>
    )
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="card text-center py-12">
        <Trophy size={40} className="mx-auto text-white/20 mb-3" />
        <p className="text-white/40">Nenhum grupo cadastrado ainda</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group, idx) => (
        <div key={group.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms` }}>
          <GroupCard group={group} rank={idx + 1} />
        </div>
      ))}
    </div>
  )
}
