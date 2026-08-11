import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import CampaignBoard from './CampaignBoard'

const STATUS = {
  draft:  { label: 'Rascunho', color: 'var(--txt3)' },
  active: { label: 'Ativa',    color: '#059669' },
  closed: { label: 'Encerrada', color: 'var(--txt3)' },
}

const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const ABAS = [
  { id: 'todas',      label: 'Todas' },
  { id: 'ativas',     label: 'Ativas' },
  { id: 'concluidas', label: 'Concluídas' },
  { id: 'futuras',    label: 'Futuras' },
]

/**
 * A data manda, não só o `status`. Uma campanha de um dia fica com
 * `status = 'active'` para sempre se ninguém clicar em "Encerrar" — pela data
 * ela já acabou, e é onde a pessoa espera encontrá-la. Por isso "concluída" é
 * status closed OU data de fim no passado.
 *
 * Datas vêm como 'YYYY-MM-DD', então comparar string é suficiente e evita
 * o fuso mordendo um dia (new Date('2026-08-10') vira 09/08 21h no BRT).
 */
function faseDaCampanha(c, hoje) {
  if (c.status === 'closed') return 'concluidas'
  if (c.end_date && c.end_date < hoje) return 'concluidas'
  if (c.start_date && c.start_date > hoje) return 'futuras'
  return 'ativas'
}

function showToast(msg, ok = true) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
    background: ok ? 'var(--txt)' : '#ef4444', color: ok ? 'var(--surf)' : '#fff',
    padding: '10px 20px', borderRadius: 10, fontSize: 13,
    fontWeight: 600, boxShadow: 'var(--sh-lg)',
    opacity: 1, transition: 'opacity .3s'
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 350) }, 2500)
}

// A Copa GD 2026 (ranking por equipes) já encerrou e não é uma linha de
// `campaigns` — vive em campaign_settings/groups/score_events, sistema à
// parte. Este botão tira uma foto (ranking de equipes + individuais) e grava
// como uma campanha arquivada, pra aparecer na lista abaixo. Idempotente:
// clicar de novo só atualiza a foto de uma linha já arquivada.
function ArchiveLegacyButton({ hasLegacy, onDone }) {
  const [busy, setBusy] = useState(false)

  const handleArchive = async () => {
    if (!window.confirm(
      hasLegacy
        ? 'Recapturar o snapshot da Copa GD 2026 com o ranking de agora?'
        : 'Arquivar a Copa GD 2026? Isso tira uma foto do ranking de equipes e dos rankings ' +
          'individuais de agora e grava pra sempre como uma campanha encerrada, protegida ' +
          'mesmo que esse sistema de equipes seja reaproveitado no futuro.'
    )) return

    setBusy(true)
    try {
      await api.post('/campaigns/archive-legacy')
      showToast(hasLegacy ? 'Snapshot atualizado!' : 'Copa GD 2026 arquivada!')
      onDone?.()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao arquivar a Copa GD 2026', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className="btn" disabled={busy} onClick={handleArchive} style={{ marginBottom: 12 }}>
      {busy ? '⏳ Processando…' : hasLegacy ? '🔄 Recapturar Copa GD 2026' : '📦 Arquivar Copa GD 2026'}
    </button>
  )
}

function CampaignRow({ c, isAdmin, onChanged, onOpen }) {
  const [start, setStart] = useState(c.start_date || '')
  const [end, setEnd] = useState(c.end_date || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async (patch) => {
    setSaving(true); setMsg('')
    try {
      await api.put(`/campaigns/${c.id}`, patch)
      setMsg('salvo')
      onChanged?.()
    } catch (err) {
      setMsg(err.response?.data?.error || 'erro ao salvar')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 2500)
    }
  }

  // O placar congela sozinho às 00:05 do dia seguinte e não muda mais. Isto é a
  // saída para quando o banco confirma um pagamento depois da virada.
  const recongelar = async () => {
    if (!confirm(
      'Refazer o placar congelado desta campanha com os dados de agora?\n\n' +
      'O resultado gravado será substituído — use quando algum pagamento entrou ' +
      'no NewCorban depois da virada do dia.'
    )) return

    setSaving(true); setMsg('')
    try {
      const { data } = await api.post(`/campaigns/${c.id}/freeze`)
      setMsg(`recongelada · ${data.totals?.contracts ?? 0} contrato(s)`)
      onChanged?.()
    } catch (err) {
      setMsg(err.response?.data?.detail || err.response?.data?.error || 'erro ao recongelar')
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  const st = STATUS[c.status] || STATUS.draft
  const ladder = Array.isArray(c.ladder) ? c.ladder : []
  const isLegacy = Boolean(c.legacy_kind)

  return (
    <div className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => onOpen(c.id, false)}
          title="Ver o placar desta campanha"
          style={{
            flex: '1 1 260px', minWidth: 0, textAlign: 'left', cursor: 'pointer',
            background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 17 }}>{c.name}</strong>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: st.color }}>
              {st.label}
            </span>
          </div>
          {c.subtitle ? (
            <div style={{ fontSize: 13, color: 'var(--txt2)', marginTop: 4 }}>{c.subtitle}</div>
          ) : null}

          {ladder.length ? (
            <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 8 }}>
              Escada:{' '}
              {ladder.map((t, i) => (
                <span key={t.at}>{i > 0 ? ' · ' : ''}{t.at} → {fmtBRL(t.prize)}</span>
              ))}
              {c.ladder_step ? ` · depois +${fmtBRL(c.ladder_step.prize)} a cada ${c.ladder_step.every}` : ''}
              {c.spin_every ? ` · 1 giro a cada ${c.spin_every}` : ''}
            </div>
          ) : null}

          {!isLegacy ? (
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 6 }}>
              Produto {(c.product_ids || []).join(', ') || '—'}
              {c.require_same_day ? ' · digitado e pago no mesmo dia' : ''}
              {c.franquia_ids?.length ? ` · franquia ${c.franquia_ids.join(', ')}` : ' · todas as franquias'}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--gold)', marginTop: 10, fontWeight: 700 }}>
            Ver o placar →
          </div>
        </button>

        <button className="tv-btn" data-color={c.color || 'azul'} onClick={() => onOpen(c.id, true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="4" width="20" height="14" />
            <path d="M8 21h8M12 18v3" />
          </svg>
          Abrir na TV
        </button>
      </div>

      {isAdmin && !isLegacy ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <label className="field-group" style={{ margin: 0 }}>
            <span className="field-label">Início</span>
            <input type="date" className="field-input" value={start} onChange={e => setStart(e.target.value)} />
          </label>
          <label className="field-group" style={{ margin: 0 }}>
            <span className="field-label">Fim</span>
            <input type="date" className="field-input" value={end} onChange={e => setEnd(e.target.value)} />
          </label>
          <button
            className="btn"
            disabled={saving}
            onClick={() => save({ start_date: start || null, end_date: end || null })}
          >
            Salvar datas
          </button>

          {c.status !== 'active' ? (
            <button className="btn" disabled={saving} onClick={() => save({ status: 'active' })}>Ativar</button>
          ) : (
            <button className="btn" disabled={saving} onClick={() => save({ status: 'closed' })}>Encerrar</button>
          )}

          {c.status === 'closed' && !isLegacy ? (
            <button className="btn" disabled={saving} onClick={recongelar} title="Refaz o placar congelado com os dados de agora">
              🧊 Recongelar
            </button>
          ) : null}

          {msg ? <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{msg}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export default function ShellCampaigns() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [list, setList] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState(null)   // { id, fs }
  const [aba, setAba] = useState('todas')

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/campaigns')
      setList(data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível carregar as campanhas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const hasLegacy = list.some(c => c.legacy_kind)

  const hoje = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD no fuso local
  const contagem = ABAS.reduce((acc, a) => {
    acc[a.id] = a.id === 'todas' ? list.length : list.filter(c => faseDaCampanha(c, hoje) === a.id).length
    return acc
  }, {})
  const visiveis = aba === 'todas' ? list : list.filter(c => faseDaCampanha(c, hoje) === aba)

  return (
    <div className="pw">
      <div className="sec-label">Campanhas</div>

      {!loading && !error ? (
        <div className="camp-tabs">
          {ABAS.map(a => (
            <button
              key={a.id}
              className={`camp-tab${aba === a.id ? ' is-on' : ''}`}
              onClick={() => setAba(a.id)}
              aria-pressed={aba === a.id}
            >
              {a.label}
              {contagem[a.id] ? <span className="camp-tab-n">{contagem[a.id]}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {isAdmin && !loading && !error ? (
        <ArchiveLegacyButton hasLegacy={hasLegacy} onDone={load} />
      ) : null}

      {loading ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>Carregando…</div>
      ) : error ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>{error}</div>
      ) : list.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>
          Nenhuma campanha cadastrada ainda.
        </div>
      ) : visiveis.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--txt2)' }}>
          Nenhuma campanha {ABAS.find(a => a.id === aba)?.label.toLowerCase()} no momento.
        </div>
      ) : (
        visiveis.map(c => (
          <CampaignRow
            key={c.id}
            c={c}
            isAdmin={isAdmin}
            onChanged={load}
            onOpen={(id, fs) => setBoard({ id, fs })}
          />
        ))
      )}

      {board ? (
        <CampaignBoard campaignId={board.id} fullscreen={board.fs} onClose={() => setBoard(null)} />
      ) : null}
    </div>
  )
}
