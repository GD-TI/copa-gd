import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'

const RULE_ICONS = {
  META_DIA: '🎯',
  META_SEMANA: '📅',
  INDICACAO: '👥',
  CONTRATO_10K: '💰',
  GOL_DE_PLACA: '⚽',
  TORCIDA_ORGANIZADA: '🎉',
  ARTILHEIRO: '🏆',
  AJUSTE_ADMIN: '⚙️',
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="w-8 h-8 rounded-full bg-copa-yellow text-copa-navy font-black text-sm flex items-center justify-center">1°</span>
  if (rank === 2) return <span className="w-8 h-8 rounded-full bg-gray-300 text-gray-800 font-black text-sm flex items-center justify-center">2°</span>
  if (rank === 3) return <span className="w-8 h-8 rounded-full bg-amber-600 text-white font-black text-sm flex items-center justify-center">3°</span>
  return <span className="w-8 h-8 rounded-full bg-white/10 text-white/60 font-bold text-sm flex items-center justify-center">{rank}°</span>
}

export default function GroupCard({ group, rank, compact = false }) {
  const glowClass = rank === 1 ? 'glow-gold' : rank === 2 ? 'glow-silver' : rank === 3 ? 'glow-bronze' : ''

  return (
    <Link
      to={`/groups/${group.id}`}
      className={`card hover:border-copa-green/40 transition-all duration-200 hover:-translate-y-0.5 block ${glowClass} ${
        rank === 1 ? 'border-copa-yellow/30 bg-brazil-gradient' : ''
      }`}
    >
      <div className="flex items-center gap-4">
        {/* Rank */}
        <RankBadge rank={rank} />

        {/* Foto do grupo */}
        <div className="w-12 h-12 rounded-full overflow-hidden bg-copa-blue flex-shrink-0 border-2 border-white/10">
          {group.photo_url ? (
            <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">⚽</div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white truncate text-base">{group.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1 text-white/50 text-xs">
              <Users size={11} />
              {group.member_count}/5
            </span>
            {!compact && group.today_points > 0 && (
              <span className="badge-green">+{group.today_points} hoje</span>
            )}
          </div>
        </div>

        {/* Pontos */}
        <div className="text-right flex-shrink-0">
          <div className={`font-black text-2xl tabular-nums ${rank === 1 ? 'text-copa-yellow' : 'text-white'}`}>
            {Number(group.total_points).toLocaleString('pt-BR')}
          </div>
          <div className="text-white/40 text-xs">pontos</div>
        </div>
      </div>
    </Link>
  )
}

export { RULE_ICONS }
