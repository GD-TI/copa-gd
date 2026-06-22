import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trophy, Calendar, Clock, Users } from 'lucide-react'
import api from '../api/client'

const MEDAL = ['🥇', '🥈', '🥉']
const RANK_LABEL = ['CAMPEÃO', '2º LUGAR', '3º LUGAR']

function formatDate(d) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysLeft(end) {
  if (!end) return null
  const diff = Math.ceil((new Date(end + 'T23:59:59') - new Date()) / 86400000)
  return diff
}

function campaignProgress(start, end) {
  if (!start || !end) return 0
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  const n = Date.now()
  if (n <= s) return 0
  if (n >= e) return 100
  return Math.round(((n - s) / (e - s)) * 100)
}

// ─── Champion card (top 3) ───────────────────────────────────
function ChampCard({ group, rank, maxPoints }) {
  const initials = group.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const pct = maxPoints > 0 ? Math.round((group.total_points / maxPoints) * 100) : 0
  const pts = Number(group.total_points)

  const variants = [
    {
      bg: 'linear-gradient(145deg,#3D2800 0%,#5C3D00 30%,#7A5200 60%,#2A1A00 100%)',
      border: 'rgba(245,158,11,0.45)',
      shadow: '0 6px 28px rgba(245,158,11,0.18), 0 2px 8px rgba(0,0,0,0.4)',
      topBar: 'linear-gradient(90deg,#92600A,#F59E0B,#FDE68A,#F59E0B,#92600A)',
      nameCls: 'text-amber-50',
      valCls:  '#FFD700',
      subCls:  'rgba(255,215,100,0.55)',
      progBar: 'linear-gradient(90deg,#D97706,#F59E0B,#FDE68A)',
      pctCls:  'rgba(255,215,100,0.85)',
      avBorder:'rgba(255,200,60,0.7)',
      rankCls: 'rgba(255,220,120,0.85)',
      wmCls:   '#F59E0B',
    },
    {
      bg: 'linear-gradient(145deg,#1A1D26 0%,#252A38 30%,#1E2230 70%,#141720 100%)',
      border: 'rgba(156,163,175,0.35)',
      shadow: '0 4px 20px rgba(156,163,175,0.1), 0 2px 8px rgba(0,0,0,0.4)',
      topBar: 'linear-gradient(90deg,#4B5563,#9CA3AF,#E5E7EB,#9CA3AF,#4B5563)',
      nameCls: 'text-gray-100',
      valCls:  '#E5E7EB',
      subCls:  'rgba(200,210,220,0.5)',
      progBar: 'linear-gradient(90deg,#6B7280,#9CA3AF,#E5E7EB)',
      pctCls:  'rgba(200,210,220,0.75)',
      avBorder:'rgba(180,190,200,0.5)',
      rankCls: 'rgba(210,220,235,0.8)',
      wmCls:   '#9CA3AF',
    },
    {
      bg: 'linear-gradient(145deg,#2D1400 0%,#451E00 30%,#3A1800 70%,#200E00 100%)',
      border: 'rgba(205,127,50,0.38)',
      shadow: '0 4px 20px rgba(205,127,50,0.12), 0 2px 8px rgba(0,0,0,0.4)',
      topBar: 'linear-gradient(90deg,#7C2D12,#B45309,#FBBF24,#B45309,#7C2D12)',
      nameCls: 'text-orange-50',
      valCls:  '#FBBF24',
      subCls:  'rgba(255,185,110,0.5)',
      progBar: 'linear-gradient(90deg,#92400E,#B45309,#F59E0B)',
      pctCls:  'rgba(255,185,110,0.8)',
      avBorder:'rgba(205,127,50,0.55)',
      rankCls: 'rgba(255,200,130,0.82)',
      wmCls:   '#CD7F32',
    },
  ]
  const v = variants[rank - 1]

  return (
    <div
      className="relative rounded-2xl p-5 flex items-center gap-4 overflow-hidden transition-transform duration-200 hover:translate-x-1"
      style={{ background: v.bg, border: `1.5px solid ${v.border}`, boxShadow: v.shadow }}
    >
      {/* Top border line */}
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ background: v.topBar }} />

      {/* Watermark */}
      <div className="absolute right-[-10px] bottom-[-14px] text-[80px] font-black select-none pointer-events-none opacity-[0.06]"
        style={{ color: v.wmCls, fontFamily: "'Bebas Neue', sans-serif", lineHeight: 1 }}>
        {rank}
      </div>

      {/* Rank label */}
      <div className="absolute top-3 right-4 text-[9px] font-bold tracking-[3px] uppercase"
        style={{ color: v.rankCls }}>
        {RANK_LABEL[rank - 1]}
      </div>

      {/* Crown for #1 */}
      {rank === 1 && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 text-2xl animate-bounce" style={{ filter: 'drop-shadow(0 2px 8px rgba(245,158,11,0.6))' }}>
          👑
        </div>
      )}

      {/* Avatar */}
      <div className="relative flex-shrink-0 mt-1">
        <div
          className="rounded-full flex items-center justify-center overflow-hidden font-bold text-xl"
          style={{
            width: rank === 1 ? 80 : 66,
            height: rank === 1 ? 80 : 66,
            border: `2.5px solid ${v.avBorder}`,
            background: 'rgba(0,0,0,0.25)',
            boxShadow: rank === 1 ? '0 0 0 5px rgba(245,158,11,0.15), 0 0 20px rgba(245,158,11,0.25)' : undefined,
            color: rank === 1 ? '#FDE68A' : rank === 2 ? '#D1D5DB' : '#FDDBB4',
          }}
        >
          {group.photo_url
            ? <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
            : initials
          }
        </div>
        {/* Medal badge */}
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-8 h-8 flex items-center justify-center text-lg"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
          {MEDAL[rank - 1]}
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 mt-3">
        <p className={`font-bold leading-tight truncate ${v.nameCls}`}
          style={{ fontSize: rank === 1 ? 22 : 19 }}>
          {group.name}
        </p>
        <p className="text-xs mt-0.5" style={{ color: v.subCls }}>
          {group.member_count} {group.member_count === 1 ? 'membro' : 'membros'}
        </p>

        {/* Points */}
        <p className="font-bold mt-2 tabular-nums leading-none"
          style={{ fontSize: rank === 1 ? 32 : 26, color: v.valCls, textShadow: rank === 1 ? '0 1px 12px rgba(245,158,11,0.4)' : undefined }}>
          {pts.toLocaleString('pt-BR')} <span className="text-sm font-semibold opacity-60">pts</span>
        </p>

        {/* Progress bar */}
        <div className="mt-2.5 space-y-1">
          <div className="h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.25)' }}>
            <div className="h-full rounded-full transition-all duration-[1400ms]"
              style={{ width: `${pct}%`, background: v.progBar }} />
          </div>
          <p className="text-[11px] tabular-nums" style={{ color: v.pctCls }}>{pct}%</p>
        </div>
      </div>
    </div>
  )
}

// ─── Table row (rank 4+) ─────────────────────────────────────
function RankRow({ group, rank }) {
  const initials = group.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const pts = Number(group.total_points)

  const topClass = rank === 1
    ? 'border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent'
    : rank === 2
    ? 'border-gray-400/18 bg-gradient-to-r from-gray-400/5 to-transparent'
    : rank === 3
    ? 'border-orange-700/15 bg-gradient-to-r from-orange-700/5 to-transparent'
    : 'border-white/10 bg-copa-card'

  const valColor = rank === 1 ? 'text-amber-400' : rank === 2 ? 'text-white' : rank === 3 ? 'text-orange-400' : 'text-white/80'

  return (
    <div className={`relative flex items-center gap-3 px-4 py-3 rounded-xl border mb-2 transition-all hover:translate-x-1 ${topClass}`}>
      {/* Left accent bar for top 3 */}
      {rank <= 3 && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
          style={{
            background: rank === 1
              ? 'linear-gradient(180deg,#F59E0B,#D97706)'
              : rank === 2
              ? 'linear-gradient(180deg,#9CA3AF,#6B7280)'
              : 'linear-gradient(180deg,#B45309,#92400E)',
          }} />
      )}

      {/* Position */}
      <div className="w-9 text-center flex-shrink-0">
        {rank <= 3
          ? <span className="text-xl">{MEDAL[rank - 1]}</span>
          : <span className="text-white/40 font-bold text-base tabular-nums">{rank}</span>
        }
      </div>

      {/* Avatar */}
      <div className="w-9 h-9 rounded-full flex-shrink-0 overflow-hidden bg-copa-blue/40 border border-white/20 flex items-center justify-center text-xs font-bold text-white/70">
        {group.photo_url
          ? <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
          : initials
        }
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm truncate">{group.name}</p>
        <p className="text-white/40 text-xs flex items-center gap-1 mt-0.5">
          <Users size={10} /> {group.member_count} {group.member_count === 1 ? 'membro' : 'membros'}
        </p>
      </div>

      {/* Points */}
      <div className={`font-bold tabular-nums text-right flex-shrink-0 ${valColor}`}
        style={{ fontSize: rank === 1 ? 21 : rank === 2 ? 19 : 17 }}>
        {pts.toLocaleString('pt-BR')}
        <span className="text-xs font-normal opacity-60 ml-0.5">pts</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────
export default function Ranking() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const { data: res } = await api.get('/groups/ranking')
      setData(res)
    } catch {
      // mantém dados anteriores em caso de falha
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => load(true), 60000)
    return () => clearInterval(timer)
  }, [load])

  const groups = data?.groups || []
  const campaign = data?.campaign
  const top3 = groups.slice(0, 3)
  const rest  = groups.slice(3)
  const maxPts = top3[0]?.total_points ? Number(top3[0].total_points) : 1
  const progress = campaignProgress(campaign?.start_date, campaign?.end_date)
  const days = daysLeft(campaign?.end_date)

  return (
    <div className="min-h-screen bg-copa-navy">
      {/* ── Campaign strip ── */}
      <div className="bg-copa-card border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Trophy size={14} className="text-copa-yellow" />
            <span className="text-white font-bold text-sm">{campaign?.name || 'Copa GD 2026'}</span>
          </div>

          <div className="w-px h-5 bg-white/15 flex-shrink-0" />

          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <Calendar size={12} />
            <span>{formatDate(campaign?.start_date)}</span>
            <span className="text-white/25">→</span>
            <span>{formatDate(campaign?.end_date)}</span>
          </div>

          <div className="flex-1 min-w-[120px] flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#009C3B,#34D399)' }}
              />
            </div>
            {days !== null && (
              <span className="text-copa-yellow text-xs font-semibold flex-shrink-0 flex items-center gap-1">
                <Clock size={11} />
                {days > 0 ? `${days}d restantes` : days === 0 ? 'Último dia' : 'Encerrada'}
              </span>
            )}
          </div>

          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="ml-auto text-white/30 hover:text-white/70 transition-colors flex-shrink-0"
            title="Atualizar"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">
              <span className="text-copa-yellow">Ranking</span>
              <span className="text-white/30 font-normal text-base ml-2">— por grupo</span>
            </h1>
            <p className="text-white/40 text-sm mt-0.5">{groups.length} grupos na campanha</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="card animate-pulse h-28 bg-copa-card/50" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="card text-center py-16">
            <Trophy size={48} className="mx-auto text-white/20 mb-4" />
            <p className="text-white/40 text-lg font-medium">Nenhum grupo com pontuação ainda</p>
            <p className="text-white/25 text-sm mt-1">Os pontos aparecem aqui após o primeiro cálculo</p>
          </div>
        ) : (
          <>
            {/* ── Top 3 champion cards ── */}
            {top3.length > 0 && (
              <div>
                <p className="text-[9px] font-bold tracking-[3px] uppercase text-white/30 mb-3 flex items-center gap-2">
                  Pódio
                  <span className="flex-1 h-px bg-white/10" />
                </p>
                <div className="space-y-3">
                  {top3.map((g, i) => (
                    <ChampCard key={g.id} group={g} rank={i + 1} maxPoints={maxPts} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Rest of ranking ── */}
            {rest.length > 0 && (
              <div>
                <p className="text-[9px] font-bold tracking-[3px] uppercase text-white/30 mb-3 flex items-center gap-2">
                  Classificação
                  <span className="flex-1 h-px bg-white/10" />
                </p>
                {/* Table header */}
                <div className="grid px-4 pb-2 text-[9px] font-bold tracking-[2px] uppercase text-white/25"
                  style={{ gridTemplateColumns: '36px 40px 1fr 90px' }}>
                  <span className="text-center">#</span>
                  <span />
                  <span>Grupo</span>
                  <span className="text-right">Pontos</span>
                </div>
                {rest.map((g, i) => (
                  <RankRow key={g.id} group={g} rank={i + 4} />
                ))}
              </div>
            )}

            {/* If less than 4 groups, show everything as rows too */}
            {groups.length <= 3 && top3.length > 0 && (
              <div>
                <p className="text-[9px] font-bold tracking-[3px] uppercase text-white/30 mb-3 flex items-center gap-2">
                  Tabela completa
                  <span className="flex-1 h-px bg-white/10" />
                </p>
                {groups.map((g, i) => (
                  <RankRow key={g.id} group={g} rank={i + 1} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
