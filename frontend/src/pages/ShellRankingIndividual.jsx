import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

function d10(s) { return s ? String(s).slice(0, 10) : '' }
function fDate(s) {
  const v = d10(s)
  if (!v) return '—'
  const d = new Date(v + 'T00:00:00')
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const BALL_LABELS  = ['Bola de Ouro', 'Bola de Prata', 'Bola de Bronze']
const BALL_CLS     = ['ir-gold', 'ir-silver', 'ir-bronze']
const ASSIST_ICONS = ['🥇', '🥈', '🥉']

function IndCard({ title, icon, items, formatValue, emptyMsg, isBola }) {
  return (
    <div className="ir-card ir-card-full">
      <div className="ir-card-head">
        <span className="ir-card-icon">{icon}</span>
        <span className="ir-card-title">{title}</span>
      </div>
      {items.length === 0
        ? <div className="ir-empty">{emptyMsg}</div>
        : items.map((item, i) => (
          <div key={item.vendedor_id} className={`ir-row ${BALL_CLS[i] || ''}`}>
            <div className="ir-medal-col">
              <span className="ir-ball">
                {isBola ? '⚽' : ASSIST_ICONS[i]}
              </span>
              <span className="ir-rank-lbl">
                {isBola ? BALL_LABELS[i] : `${i + 1}º lugar`}
              </span>
            </div>
            <div className="ir-name">{item.name}</div>
            <div className="ir-value">{formatValue(item)}</div>
          </div>
        ))
      }
    </div>
  )
}

export default function ShellRankingIndividual() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [campaign, setCampaign] = useState(null)

  const load = useCallback(() => {
    api.get('/scores/individual-rankings')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))

    api.get('/groups/ranking')
      .then(r => { if (r.data.campaign) setCampaign(r.data.campaign) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()

    const es = new EventSource('/api/events/stream')
    es.addEventListener('scores_updated', () => load())
    es.onerror = () => {}

    const t = setInterval(load, 300000)
    return () => { es.close(); clearInterval(t) }
  }, [load])

  return (
    <>
      {/* Campaign strip */}
      {campaign && (
        <div className="camp-strip">
          <div className="cs-seg">
            <span className="cs-label">Início</span>
            <span className="cs-val">{fDate(campaign.start_date)}</span>
          </div>
          <div className="cs-div" />
          <div className="cs-seg">
            <span className="cs-label">Fim</span>
            <span className="cs-val">{fDate(campaign.end_date)}</span>
          </div>
        </div>
      )}

      <div className="ir-section">
        {loading
          ? <div className="ir-loading">Carregando rankings…</div>
          : (
            <div className="ir-grid">
              <IndCard
                title="Melhor Vendedor"
                icon="⚽"
                isBola
                items={data?.melhor_vendedor || []}
                formatValue={item => `R$ ${item.total_valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                emptyMsg="Nenhuma proposta paga no período"
              />
              <IndCard
                title="Rei das Assistências"
                icon="🤝"
                isBola={false}
                items={data?.rei_assistencias || []}
                formatValue={item => `${item.indicacao_count} indicaç${item.indicacao_count === 1 ? 'ão' : 'ões'}`}
                emptyMsg="Nenhuma proposta por indicação no período"
              />
            </div>
          )
        }
      </div>
    </>
  )
}
