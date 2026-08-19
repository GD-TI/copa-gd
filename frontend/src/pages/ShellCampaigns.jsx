import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, CalendarDays, CheckCircle2, Clock3, Eye, FileEdit, FileText,
  MonitorUp, MoreHorizontal, Plus, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import CampaignBoard from './CampaignBoard'
import CampaignForm from '../components/CampaignForm'
import { showToast } from '../utils/toast'

const ABAS = [
  { id: 'todas', label: 'Todas' },
  { id: 'ativas', label: 'Em andamento' },
  { id: 'futuras', label: 'Agendadas' },
  { id: 'concluidas', label: 'Encerradas' },
  { id: 'rascunhos', label: 'Rascunhos', restrita: true },
]

const ESTADOS = {
  draft: { label: 'Rascunho', classe: 'draft' },
  scheduled: { label: 'Agendada', classe: 'scheduled' },
  active: { label: 'Em andamento', classe: 'active' },
  closed: { label: 'Encerrada', classe: 'closed' },
  archived: { label: 'Arquivo histórico', classe: 'archived' },
}

const PRODUTOS = {
  '13': 'CLT',
  '7': 'FGTS',
}

const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const fmtData = valor => valor
  ? new Date(`${String(valor).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).replace('.', '')
  : 'Não definida'

function estadoDaCampanha(c, hoje) {
  if (c.legacy_kind) return 'archived'
  if (c.status === 'draft') return 'draft'
  if (c.status === 'closed' || (c.end_date && c.end_date < hoje)) return 'closed'
  if (c.start_date && c.start_date > hoje) return 'scheduled'
  return 'active'
}

function abaDaCampanha(c, hoje) {
  const estado = estadoDaCampanha(c, hoje)
  if (estado === 'draft') return 'rascunhos'
  if (estado === 'scheduled') return 'futuras'
  if (estado === 'closed' || estado === 'archived') return 'concluidas'
  return 'ativas'
}

function ConfirmDialog({ config, busy, onCancel, onConfirm }) {
  const cancelarRef = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!config) return
    cancelarRef.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape' && !busy) onCancel()
      if (event.key === 'Tab') {
        const focaveis = [...(dialogRef.current?.querySelectorAll('button:not(:disabled)') || [])]
        if (!focaveis.length) return
        const primeiro = focaveis[0]
        const ultimo = focaveis.at(-1)
        if (event.shiftKey && document.activeElement === primeiro) {
          event.preventDefault()
          ultimo.focus()
        } else if (!event.shiftKey && document.activeElement === ultimo) {
          event.preventDefault()
          primeiro.focus()
        }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [config, busy, onCancel])

  if (!config) return null

  return (
    <div className="camp-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <section
        ref={dialogRef}
        className="camp-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="camp-dialog-title"
        aria-describedby="camp-dialog-description"
      >
        <header>
          <div className={`camp-dialog-icon is-${config.tone || 'warning'}`}>
            {config.icon || <ShieldCheck size={20} aria-hidden="true" />}
          </div>
          <button className="camp-icon-btn" onClick={onCancel} disabled={busy} aria-label="Fechar confirmação">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <h2 id="camp-dialog-title">{config.title}</h2>
        <p id="camp-dialog-description">{config.description}</p>
        <footer>
          <button ref={cancelarRef} className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button
            className={`btn ${config.danger ? 'camp-btn-danger' : 'btn-gold'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Processando…' : config.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}

function ResumoCampanhas({ contagem }) {
  const itens = [
    { id: 'ativas', label: 'Em andamento', valor: contagem.ativas || 0, icon: CheckCircle2 },
    { id: 'futuras', label: 'Agendadas', valor: contagem.futuras || 0, icon: Clock3 },
    { id: 'concluidas', label: 'No histórico', valor: contagem.concluidas || 0, icon: Archive },
  ]
  return (
    <div className="camp-summary" aria-label="Resumo das campanhas">
      {itens.map(item => {
        const Icone = item.icon
        return (
          <div className={`camp-summary-item is-${item.id}`} key={item.id}>
            <Icone size={17} aria-hidden="true" />
            <strong>{item.valor}</strong>
            <span>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function CampaignCard({
  campaign, hoje, franquiaMap, isMaster, busy, onOpen, onEdit, onAction,
}) {
  const [menuAberto, setMenuAberto] = useState(false)
  const estadoId = estadoDaCampanha(campaign, hoje)
  const estado = ESTADOS[estadoId]
  const isLegacy = Boolean(campaign.legacy_kind)
  const ladder = Array.isArray(campaign.ladder) ? campaign.ladder : []
  const podeEditar = Boolean(campaign.pode_editar) && !isLegacy
  const produtos = (campaign.product_ids || []).map(id => PRODUTOS[id] || `Produto ${id}`)

  const abrangencia = isLegacy
    ? 'Snapshot da Copa GD 2026'
    : !campaign.franquia_ids?.length
      ? 'Empresa inteira'
      : campaign.franquia_ids.map(id => franquiaMap[id] || (id === 'matriz' ? 'Matriz' : `Franquia ${id}`)).join(', ')

  const regra = campaign.require_same_day
    ? 'Digitado e pago no mesmo dia'
    : 'Pagamentos do dia'

  const premioResumo = ladder.length
    ? `${ladder.length} marco${ladder.length === 1 ? '' : 's'} · até ${fmtBRL(ladder.at(-1)?.prize)}`
    : campaign.spin_every
      ? `1 giro a cada ${campaign.spin_every} contratos`
      : 'Sem prêmio automático'

  return (
    <article className={`camp-card is-${estado.classe}`}>
      <div className="camp-card-status-line" aria-hidden="true" />
      <header className="camp-card-head">
        <div className="camp-card-heading">
          <div className="camp-card-badges">
            <span className={`camp-status is-${estado.classe}`}>{estado.label}</span>
            {!isLegacy ? (
              <span className={`camp-origin ${campaign.owner_franquia_id ? 'is-franchise' : 'is-matrix'}`}>
                {campaign.owner_franquia_id
                  ? franquiaMap[campaign.owner_franquia_id] || 'Franquia'
                  : 'Matriz'}
              </span>
            ) : null}
            {campaign.frozen && !isLegacy ? (
              <span className="camp-frozen"><ShieldCheck size={12} aria-hidden="true" /> Resultado salvo</span>
            ) : null}
          </div>
          <h2>{campaign.name}</h2>
          {campaign.subtitle ? <p>{campaign.subtitle}</p> : null}
        </div>

        {podeEditar ? (
          <div className="camp-card-menu">
            <button
              type="button"
              className="camp-icon-btn"
              aria-label={`Ações de ${campaign.name}`}
              aria-expanded={menuAberto}
              onClick={() => setMenuAberto(v => !v)}
            >
              <MoreHorizontal size={19} aria-hidden="true" />
            </button>
            {menuAberto ? (
              <div className="camp-menu-popover">
                <button onClick={() => { setMenuAberto(false); onEdit(campaign) }}>
                  <FileEdit size={15} aria-hidden="true" /> Editar configuração
                </button>
                {campaign.status === 'draft' ? (
                  <button onClick={() => { setMenuAberto(false); onAction('activate', campaign) }}>
                    <CheckCircle2 size={15} aria-hidden="true" /> Ativar campanha
                  </button>
                ) : campaign.status === 'active' ? (
                  <button onClick={() => { setMenuAberto(false); onAction('close', campaign) }}>
                    <Archive size={15} aria-hidden="true" /> Encerrar campanha
                  </button>
                ) : null}
                {isMaster && campaign.status === 'closed' ? (
                  <button onClick={() => { setMenuAberto(false); onAction('refreeze', campaign) }}>
                    <RefreshCw size={15} aria-hidden="true" /> Recongelar resultado
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="camp-card-facts">
        <div>
          <CalendarDays size={16} aria-hidden="true" />
          <span><small>Período</small><strong>{fmtData(campaign.start_date)} — {fmtData(campaign.end_date || campaign.start_date)}</strong></span>
        </div>
        <div>
          <Eye size={16} aria-hidden="true" />
          <span><small>Participantes</small><strong>{abrangencia}</strong></span>
        </div>
        {!isLegacy ? (
          <div>
            <FileText size={16} aria-hidden="true" />
            <span><small>Regra</small><strong>{regra}</strong></span>
          </div>
        ) : null}
      </div>

      {!isLegacy ? (
        <div className="camp-card-rules">
          <span>{produtos.join(', ') || 'Sem produto'}</span>
          <span>{premioResumo}</span>
          {campaign.ladder_step?.every
            ? <span>Depois, {fmtBRL(campaign.ladder_step.prize)} a cada {campaign.ladder_step.every}</span>
            : null}
          {campaign.spin_every ? <span>Roleta a cada {campaign.spin_every}</span> : null}
        </div>
      ) : null}

      <footer className="camp-card-actions">
        <button className="btn btn-primary" onClick={() => onOpen(campaign.id, false)}>
          <Eye size={15} aria-hidden="true" />
          Ver placar
        </button>
        <button className="btn btn-ghost" onClick={() => onOpen(campaign.id, true)}>
          <MonitorUp size={15} aria-hidden="true" />
          Abrir na TV
        </button>
        {podeEditar ? (
          <button className="btn camp-edit-shortcut" onClick={() => onEdit(campaign)}>
            <FileEdit size={15} aria-hidden="true" />
            Editar
          </button>
        ) : null}
        {busy ? <span className="camp-card-busy" role="status">Atualizando…</span> : null}
      </footer>
    </article>
  )
}

export default function ShellCampaigns() {
  const { user } = useAuth()
  const isMaster = user?.role === 'admin'
  const podeCriar = isMaster || user?.role === 'franqueado'

  const [list, setList] = useState([])
  const [franquiaMap, setFranquiaMap] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState(null)
  const [aba, setAba] = useState('todas')
  const [busca, setBusca] = useState('')
  const [editor, setEditor] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [busyAction, setBusyAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [campanhas, franquias] = await Promise.allSettled([
      api.get('/campaigns'),
      api.get('/franquias'),
    ])

    if (campanhas.status === 'fulfilled') {
      setList(campanhas.value.data || [])
      setError('')
    } else {
      setError(campanhas.reason.response?.data?.error || 'Não foi possível carregar as campanhas')
    }

    if (franquias.status === 'fulfilled') {
      setFranquiaMap(Object.fromEntries(
        (franquias.value.data?.franquias || []).map(f => [f.id, f.nome])
      ))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const hoje = new Date().toLocaleDateString('en-CA')
  const hasLegacy = list.some(c => c.legacy_kind)

  const contagem = useMemo(() => ABAS.reduce((acc, item) => {
    acc[item.id] = item.id === 'todas'
      ? list.length
      : list.filter(c => abaDaCampanha(c, hoje) === item.id).length
    return acc
  }, {}), [list, hoje])

  const abasVisiveis = ABAS.filter(item => !item.restrita || podeCriar)
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const visiveis = list.filter(c => {
    const naAba = aba === 'todas' || abaDaCampanha(c, hoje) === aba
    const noTexto = !termo || [
      c.name, c.subtitle,
      ...(c.franquia_ids || []).map(id => franquiaMap[id] || id),
    ].some(valor => String(valor || '').toLocaleLowerCase('pt-BR').includes(termo))
    return naAba && noTexto
  })

  const abrirConfirmacao = (acao, campaign = null) => {
    const configs = {
      activate: {
        action: acao,
        campaign,
        title: `Ativar “${campaign?.name}”?`,
        description: 'A campanha ficará visível para todos os participantes do escopo e o placar passará a valer.',
        confirmLabel: 'Ativar campanha',
      },
      close: {
        action: acao,
        campaign,
        title: `Encerrar “${campaign?.name}”?`,
        description: 'A campanha sai do estado ativo. O resultado será congelado automaticamente após o encerramento do dia.',
        confirmLabel: 'Encerrar campanha',
        danger: true,
        tone: 'danger',
      },
      refreeze: {
        action: acao,
        campaign,
        title: `Recongelar “${campaign?.name}”?`,
        description: 'O resultado salvo será substituído pelos números atuais do NewCorban. Use apenas para pagamentos confirmados após a virada.',
        confirmLabel: 'Recongelar resultado',
        icon: <RefreshCw size={20} aria-hidden="true" />,
      },
      archiveLegacy: {
        action: acao,
        title: hasLegacy ? 'Atualizar o arquivo da Copa GD 2026?' : 'Arquivar a Copa GD 2026?',
        description: hasLegacy
          ? 'O snapshot histórico será recapturado com o ranking atual do sistema legado.'
          : 'Será criado um snapshot permanente dos rankings por equipes e individual.',
        confirmLabel: hasLegacy ? 'Atualizar arquivo' : 'Criar arquivo',
        icon: <Archive size={20} aria-hidden="true" />,
      },
    }
    setConfirmacao(configs[acao])
  }

  const executarConfirmacao = async () => {
    if (!confirmacao) return
    const { action, campaign } = confirmacao
    const chave = campaign ? `${action}-${campaign.id}` : action
    setBusyAction(chave)
    try {
      if (action === 'activate') await api.put(`/campaigns/${campaign.id}`, { status: 'active' })
      if (action === 'close') await api.put(`/campaigns/${campaign.id}`, { status: 'closed' })
      if (action === 'refreeze') await api.post(`/campaigns/${campaign.id}/freeze`)
      if (action === 'archiveLegacy') await api.post('/campaigns/archive-legacy')
      showToast({
        activate: 'Campanha ativada',
        close: 'Campanha encerrada',
        refreeze: 'Resultado recongelado',
        archiveLegacy: hasLegacy ? 'Arquivo da Copa atualizado' : 'Copa GD arquivada',
      }[action])
      setConfirmacao(null)
      await load()
    } catch (e) {
      showToast(e.response?.data?.detail || e.response?.data?.error || 'Não foi possível concluir a ação', false)
    } finally {
      setBusyAction('')
    }
  }

  const finalizarEdicao = async () => {
    setEditor(null)
    await load()
  }

  if (editor) {
    return (
      <div className="pw camp-page">
        <CampaignForm
          campaign={editor.campaign}
          onCancelar={() => setEditor(null)}
          onSaved={finalizarEdicao}
        />
      </div>
    )
  }

  return (
    <div className="pw camp-page">
      <header className="camp-page-header">
        <div>
          <h1>Campanhas comerciais</h1>
          <p>Crie disputas, acompanhe o período ativo e consulte resultados preservados.</p>
        </div>
        <div className="camp-page-primary-actions">
          {isMaster && !loading && !error ? (
            <button className="btn btn-ghost" onClick={() => abrirConfirmacao('archiveLegacy')}>
              <Archive size={15} aria-hidden="true" />
              {hasLegacy ? 'Atualizar arquivo da Copa' : 'Arquivar Copa GD'}
            </button>
          ) : null}
          {podeCriar && !loading && !error ? (
            <button className="btn btn-gold" onClick={() => setEditor({ campaign: null })}>
              <Plus size={16} aria-hidden="true" />
              Nova campanha
            </button>
          ) : null}
        </div>
      </header>

      {!loading && !error ? <ResumoCampanhas contagem={contagem} /> : null}

      <div className="camp-toolbar">
        <div className="camp-tabs" role="group" aria-label="Filtrar campanhas por fase">
          {abasVisiveis.map(item => (
            <button
              key={item.id}
              className={`camp-tab${aba === item.id ? ' is-on' : ''}`}
              onClick={() => setAba(item.id)}
              aria-pressed={aba === item.id}
            >
              {item.label}
              <span className="camp-tab-n">{contagem[item.id] || 0}</span>
            </button>
          ))}
        </div>
        <label className="camp-search camp-list-search">
          <Search size={16} aria-hidden="true" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar campanha" />
        </label>
      </div>

      {loading ? (
        <div className="camp-state" role="status">
          <RefreshCw className="camp-state-spinner" size={24} aria-hidden="true" />
          <h2>Carregando campanhas</h2>
          <p>Organizando períodos, permissões e resultados.</p>
        </div>
      ) : error ? (
        <div className="camp-state is-error" role="alert">
          <X size={24} aria-hidden="true" />
          <h2>Não foi possível carregar</h2>
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={load}>Tentar novamente</button>
        </div>
      ) : list.length === 0 ? (
        <div className="camp-state">
          <CalendarDays size={26} aria-hidden="true" />
          <h2>Nenhuma campanha cadastrada</h2>
          <p>Crie a primeira disputa e escolha se ela começa como rascunho ou já ativa.</p>
          {podeCriar ? (
            <button className="btn btn-gold" onClick={() => setEditor({ campaign: null })}>
              <Plus size={16} aria-hidden="true" /> Nova campanha
            </button>
          ) : null}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="camp-state">
          <Search size={24} aria-hidden="true" />
          <h2>Nenhum resultado neste filtro</h2>
          <p>Troque a fase selecionada ou limpe a busca para ver outras campanhas.</p>
          {busca ? <button className="btn btn-ghost" onClick={() => setBusca('')}>Limpar busca</button> : null}
        </div>
      ) : (
        <div className="camp-list">
          {visiveis.map(campaign => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              hoje={hoje}
              franquiaMap={franquiaMap}
              isMaster={isMaster}
              busy={busyAction.endsWith(`-${campaign.id}`)}
              onOpen={(id, fullscreen) => setBoard({ id, fullscreen })}
              onEdit={item => setEditor({ campaign: item })}
              onAction={abrirConfirmacao}
            />
          ))}
        </div>
      )}

      {board ? (
        <CampaignBoard
          campaignId={board.id}
          fullscreen={board.fullscreen}
          onClose={() => setBoard(null)}
        />
      ) : null}

      <ConfirmDialog
        config={confirmacao}
        busy={Boolean(busyAction)}
        onCancel={() => { if (!busyAction) setConfirmacao(null) }}
        onConfirm={executarConfirmacao}
      />
    </div>
  )
}
