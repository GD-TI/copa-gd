import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

function fBRL(v) {
  return 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function ini(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const RULE_COLOR = {
  META_DIA:          'var(--gold)',
  META_SEMANA:       '#60a5fa',
  CONVERSAO:         '#34d399',
  INDICACAO:         '#f472b6',
  CONTRATO_10K:      '#fb923c',
  GOL_DE_PLACA:      'var(--green)',
  TORCIDA_ORGANIZADA:'#a78bfa',
  ARTILHEIRO:        'var(--gold)',
}

function RuleRow({ rule }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 14, width: 22, textAlign: 'center', flexShrink: 0 }}>{rule.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: '600 12px/1 var(--font)', color: 'var(--txt)' }}>{rule.label}</div>
        <div style={{ font: '400 10px/1.4 var(--font)', color: 'var(--txt3)', marginTop: 2 }}>{rule.detail}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ font: '700 13px/1 var(--mono)', color: RULE_COLOR[rule.rule_name] || 'var(--txt)' }}>
          +{rule.points.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} pts
        </div>
        <div style={{ font: '400 10px/1 var(--font)', color: 'var(--txt3)', marginTop: 2 }}>
          {rule.share_pct}% do grupo
        </div>
      </div>
    </div>
  )
}

function GoalBar({ label, current, goal }) {
  if (!goal) return null
  const pct = Math.min(100, Math.round((current / goal) * 100))
  const hit = pct >= 100
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ font: '600 11px/1 var(--font)', color: 'var(--txt2)' }}>{label}</span>
        <span style={{ font: '700 11px/1 var(--mono)', color: hit ? 'var(--green)' : 'var(--gold)' }}>
          {pct}%{hit ? ' ✓' : ''}
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
        <div style={{
          width: pct + '%', height: '100%', borderRadius: 3,
          background: hit
            ? 'linear-gradient(90deg,#22c55e,#16a34a)'
            : 'linear-gradient(90deg,var(--gold-mid),var(--gold))',
          transition: 'width .4s',
        }} />
      </div>
      <div style={{ font: '400 10px/1 var(--font)', color: 'var(--txt3)' }}>
        {fBRL(current)} / {fBRL(goal)}
      </div>
    </div>
  )
}

const RULE_INFO = {
  CONVERSAO:          { icon: '🔄', label: 'Conversão' },
  CONTRATO_10K:       { icon: '💰', label: 'Contratos 10K' },
  INDICACAO:          { icon: '👥', label: 'Indicações' },
  GOL_DE_PLACA:       { icon: '⚽', label: 'Gol de Placa' },
  ARTILHEIRO:         { icon: '🏆', label: 'Artilheiro' },
  TORCIDA_ORGANIZADA: { icon: '🎉', label: 'Torcida' },
}

function TeamSummary({ ts }) {
  if (!ts) return null
  const r = ts.rules || {}
  const hasGoals = ts.daily_goal > 0 || ts.weekly_goal > 0

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <div style={{ font: '700 9px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>
        Resumo do Time
      </div>

      {/* Barras de meta */}
      {hasGoals && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
          <GoalBar label="Meta Diária" current={ts.valor_today} goal={ts.daily_goal} />
          <GoalBar label="Meta Semanal" current={ts.valor_week} goal={ts.weekly_goal} />
        </div>
      )}

      {/* Pills das demais regras */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {/* CONVERSAO */}
        {ts.total_today > 0 && (() => {
          const hit = r.CONVERSAO?.hit
          const pct = Math.round((r.CONVERSAO?.rate || 0) * 100)
          return (
            <div style={pillStyle(hit)}>
              🔄 <span>{pct}% conversão</span>
              {hit && <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>}
            </div>
          )
        })()}

        {/* CONTRATO_10K */}
        {ts.high_value_count > 0 && (
          <div style={pillStyle(true)}>
            💰 <span>{ts.high_value_count}× acima de 10K</span>
            <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>
          </div>
        )}

        {/* INDICACAO */}
        {ts.referrals_count > 0 && (() => {
          const batches = Math.floor(ts.referrals_count / 5)
          const hit = batches > 0
          return (
            <div style={pillStyle(hit)}>
              👥 <span>{ts.referrals_count} indicações</span>
              {hit && <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>}
            </div>
          )
        })()}

        {/* GOL_DE_PLACA */}
        {r.GOL_DE_PLACA?.max_contract > 0 && (
          <div style={pillStyle(r.GOL_DE_PLACA?.hit)}>
            ⚽ <span>Maior: {fBRL(r.GOL_DE_PLACA.max_contract)}</span>
            {r.GOL_DE_PLACA?.hit && <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>}
          </div>
        )}

        {/* ARTILHEIRO */}
        {ts.paid_today > 0 && (
          <div style={pillStyle(r.ARTILHEIRO?.hit)}>
            🏆 <span>{ts.paid_today} pagos hoje</span>
            {r.ARTILHEIRO?.hit && <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>}
          </div>
        )}

        {/* TORCIDA */}
        {r.TORCIDA_ORGANIZADA?.hit && (
          <div style={pillStyle(true)}>
            🎉 <span>Torcida Organizada</span>
            <span style={{ color: 'var(--green)', marginLeft: 3 }}>✓</span>
          </div>
        )}
      </div>
    </div>
  )
}

function pillStyle(hit) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 8px', borderRadius: 20,
    font: '500 11px/1 var(--font)',
    background: hit ? 'rgba(34,197,94,.12)' : 'var(--surf3)',
    border: `1px solid ${hit ? 'rgba(34,197,94,.3)' : 'var(--border)'}`,
    color: hit ? 'var(--txt)' : 'var(--txt3)',
  }
}

function PointsTab({ group }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!group?.id) return
    setLoading(true)
    api.get(`/groups/${group.id}/members/points`)
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Erro ao carregar pontos'))
      .finally(() => setLoading(false))
  }, [group?.id])

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>Carregando…</div>
  )
  if (err) return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>{err}</div>
  )

  const breakdown = data?.breakdown || []
  const teamTotal = data?.team_stats?.total_points ?? 0

  return (
    <div style={{ paddingBottom: 8 }}>
      <TeamSummary ts={data?.team_stats} />

      {/* Total do grupo */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--surf3)',
      }}>
        <div>
          <div style={{ font: '700 9px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
            Pontos do Grupo
          </div>
          <div style={{ font: '400 11px/1 var(--font)', color: 'var(--txt3)' }}>
            calculado das propostas atuais
          </div>
        </div>
        <div style={{ font: '700 26px/1 var(--mono)', color: 'var(--gold)' }}>
          {teamTotal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          <span style={{ font: '600 12px/1 var(--font)', color: 'var(--txt3)', marginLeft: 4 }}>pts</span>
        </div>
      </div>

      {/* Breakdown por regra */}
      {breakdown.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
          Nenhuma regra atingida ainda
        </div>
      ) : (
        <>
          <div style={{
            padding: '8px 16px 4px',
            font: '700 9px/1 var(--font)', color: 'var(--txt3)',
            letterSpacing: 2, textTransform: 'uppercase',
            background: 'var(--bg)',
          }}>
            Origem dos Pontos
          </div>
          {breakdown.map(b => (
            <div key={b.rule_name} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
            }}>
              {/* Icon */}
              <div style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{b.icon}</div>

              {/* Label + attribution + detail */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '600 13px/1 var(--font)', color: 'var(--txt)', marginBottom: 3 }}>
                  {b.label}
                </div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 20,
                  font: '500 11px/1 var(--font)',
                  background: b.attribution === 'Time todo' ? 'rgba(96,165,250,.1)' : 'rgba(244,114,182,.1)',
                  border: `1px solid ${b.attribution === 'Time todo' ? 'rgba(96,165,250,.25)' : 'rgba(244,114,182,.25)'}`,
                  color: b.attribution === 'Time todo' ? '#60a5fa' : '#f472b6',
                  marginBottom: 4,
                }}>
                  {b.attribution === 'Time todo' ? '👥' : '👤'} {b.attribution}
                </div>
                <div style={{ font: '400 11px/1.4 var(--font)', color: 'var(--txt3)' }}>
                  {b.detail}
                </div>
              </div>

              {/* Points */}
              <div style={{
                textAlign: 'right', flexShrink: 0,
                font: '700 16px/1 var(--mono)',
                color: RULE_COLOR[b.rule_name] || 'var(--gold)',
              }}>
                +{b.points.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                <div style={{ font: '500 9px/1 var(--font)', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 3 }}>
                  pts
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function MembersModal({ group, onClose }) {
  const [date, setDate]     = useState(today())
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState(null)
  const [tab, setTab]       = useState('propostas')

  const load = useCallback((d) => {
    if (!group?.id) return
    setLoading(true)
    setErr(null)
    api.get(`/groups/${group.id}/members/stats`, { params: { date: d } })
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Erro ao carregar dados'))
      .finally(() => setLoading(false))
  }, [group?.id])

  useEffect(() => { load(date) }, [load, date])

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  if (!group) return null

  const members  = data?.members || []
  const totals   = data?.totals  || { qtd_propostas: 0, valor_referencia: 0, contratos_pagos: 0 }
  const maxValor = Math.max(...members.map(m => m.valor_referencia), 1)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--surf)', borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)', boxShadow: 'var(--sh-lg)',
        width: '100%', maxWidth: 640, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surf3)', border: '1.5px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            font: '600 12px/1 var(--display)', color: 'var(--txt2)',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {group.photo_url
              ? <img src={group.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : ini(group.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '700 14px/1 var(--font)', color: 'var(--txt)' }}>{group.name}</div>
            <div style={{ font: '500 11px/1 var(--font)', color: 'var(--txt3)', marginTop: 3 }}>
              Contribuição individual dos vendedores
            </div>
          </div>
          {/* Date picker — só na aba propostas */}
          {tab === 'propostas' && (
            <input
              type="date"
              value={date}
              max={today()}
              onChange={e => setDate(e.target.value)}
              style={{
                background: 'var(--bg)', border: '1.5px solid var(--border)',
                color: 'var(--txt)', borderRadius: 'var(--r-sm)',
                padding: '5px 10px', font: '500 12px/1 var(--font)',
                outline: 'none', cursor: 'pointer',
              }}
            />
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--txt3)', fontSize: 18, lineHeight: 1,
              padding: '4px 6px', borderRadius: 6, transition: 'color .15s',
            }}
            onMouseEnter={e => e.target.style.color = 'var(--txt)'}
            onMouseLeave={e => e.target.style.color = 'var(--txt3)'}
          >✕</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border)',
          flexShrink: 0, background: 'var(--bg)',
        }}>
          {[
            { key: 'propostas', label: '📋 Propostas' },
            { key: 'pontos',    label: '⭐ Pontos do Grupo' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '10px 12px', border: 'none', cursor: 'pointer',
                font: '600 12px/1 var(--font)', background: 'transparent',
                color: tab === t.key ? 'var(--gold)' : 'var(--txt3)',
                borderBottom: tab === t.key ? '2px solid var(--gold)' : '2px solid transparent',
                transition: 'color .15s, border-color .15s',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* ---- Aba Propostas ---- */}
          {tab === 'propostas' && (
            <>
              {loading && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>Carregando…</div>
              )}
              {!loading && err && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>{err}</div>
              )}
              {!loading && !err && members.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
                  Nenhum dado encontrado para esta data
                </div>
              )}
              {!loading && !err && members.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      <th style={thStyle({ textAlign: 'left' })}>Vendedor</th>
                      <th style={thStyle({ textAlign: 'right' })}>Propostas<div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>qtd</div></th>
                      <th style={thStyle({ textAlign: 'right' })}>Pagos<div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>contratos</div></th>
                      <th style={thStyle({ textAlign: 'right', minWidth: 160 })}>Valor Ref.<div style={{ fontWeight: 400, color: 'var(--txt3)', marginTop: 2 }}>R$</div></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const barPct = maxValor > 0 ? (m.valor_referencia / maxValor) * 100 : 0
                      return (
                        <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '10px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: 'var(--surf3)', border: '1.5px solid var(--border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                font: '600 10px/1 var(--display)', color: 'var(--txt2)', flexShrink: 0,
                              }}>
                                {ini(m.display_name)}
                              </div>
                              <div>
                                <div style={{ font: '600 13px/1 var(--font)', color: 'var(--txt)' }}>
                                  {m.display_name}
                                  {m.is_captain && (
                                    <span style={{
                                      marginLeft: 6, fontSize: 9, fontWeight: 700,
                                      letterSpacing: 1, textTransform: 'uppercase',
                                      color: 'var(--gold)', background: 'var(--gold-soft)',
                                      padding: '2px 5px', borderRadius: 4,
                                    }}>Capitão</span>
                                  )}
                                </div>
                                {!m.corban_id && (
                                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>sem corban_id</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            <span style={{ font: '600 14px/1 var(--mono)', color: 'var(--txt)' }}>{m.qtd_propostas}</span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            <span style={{ font: '600 14px/1 var(--mono)', color: m.contratos_pagos > 0 ? 'var(--green)' : 'var(--txt3)' }}>
                              {m.contratos_pagos}
                            </span>
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span style={{ font: '700 13px/1 var(--mono)', color: 'var(--txt)' }}>{fBRL(m.valor_referencia)}</span>
                              <div style={{ width: 80, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{
                                  width: barPct + '%', height: '100%',
                                  background: 'linear-gradient(90deg,var(--gold-mid),var(--gold))',
                                  borderRadius: 2, transition: 'width .3s',
                                }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg)', borderTop: '2px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px', font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 1, textTransform: 'uppercase' }}>Total da equipe</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', font: '700 14px/1 var(--mono)', color: 'var(--txt)' }}>{totals.qtd_propostas}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', font: '700 14px/1 var(--mono)', color: 'var(--green)' }}>{totals.contratos_pagos}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', font: '700 13px/1 var(--mono)', color: 'var(--gold)' }}>{fBRL(totals.valor_referencia)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </>
          )}

          {/* ---- Aba Pontos ---- */}
          {tab === 'pontos' && <PointsTab group={group} />}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', flexShrink: 0,
          background: 'var(--bg)',
        }}>
          <button className="btn" onClick={onClose} style={{ fontSize: 12, padding: '7px 18px' }}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

function thStyle(extra = {}) {
  return {
    padding: '8px 16px',
    font: '700 9px/1 var(--font)',
    letterSpacing: 2, textTransform: 'uppercase',
    color: 'var(--txt3)',
    borderBottom: '1px solid var(--border)',
    ...extra,
  }
}
