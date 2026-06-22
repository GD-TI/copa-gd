import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { RULE_ICONS } from './GroupCard'

export default function ScoreEvents({ events, title = 'Eventos de Pontuação' }) {
  if (!events || events.length === 0) {
    return (
      <div className="card">
        <h3 className="font-bold text-white mb-3">{title}</h3>
        <p className="text-white/40 text-sm text-center py-4">Sem eventos registrados</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h3 className="font-bold text-white mb-4">{title}</h3>
      <div className="space-y-2">
        {events.map(event => (
          <div
            key={event.id}
            className="flex items-start gap-3 p-3 bg-copa-navy rounded-lg border border-white/5"
          >
            <span className="text-xl flex-shrink-0 mt-0.5">
              {RULE_ICONS[event.rule_name] || '📌'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white">{event.description}</span>
                {event.is_double_points && (
                  <span className="badge-yellow">2x 🇧🇷</span>
                )}
              </div>
              <span className="text-xs text-white/40">
                {format(new Date(event.event_date), "dd 'de' MMM", { locale: ptBR })}
              </span>
            </div>
            <div className={`font-black text-lg flex-shrink-0 ${event.points >= 0 ? 'text-copa-green' : 'text-red-400'}`}>
              {event.points >= 0 ? '+' : ''}{event.points}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
