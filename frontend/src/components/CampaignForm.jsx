import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Info, Plus, Search, Trash2, X,
} from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../utils/toast'

const PRODUTOS = [
  { id: '13', nome: 'Crédito do Trabalhador (CLT)' },
  { id: '7', nome: 'FGTS' },
]

const ETAPAS = [
  { id: 'identidade', label: 'Identidade e período' },
  { id: 'regras', label: 'Participantes e regras' },
  { id: 'premios', label: 'Premiação' },
  { id: 'revisao', label: 'Revisão' },
]

let proximoId = 0
const linhaVazia = (at = '', prize = '') => ({ id: `degrau-${++proximoId}`, at, prize })

const normalizarDegraus = campaign => {
  const ladder = Array.isArray(campaign?.ladder) ? campaign.ladder : []
  return ladder.length
    ? ladder.map(d => linhaVazia(String(d.at ?? ''), String(d.prize ?? '')))
    : [linhaVazia()]
}

function Stepper({ atual }) {
  return (
    <nav className="camp-form-steps" aria-label="Etapas da campanha">
      {ETAPAS.map((etapa, index) => {
        const concluida = index < atual
        const ativa = index === atual
        return (
          <div
            className={`camp-form-step${ativa ? ' is-active' : ''}${concluida ? ' is-done' : ''}`}
            key={etapa.id}
            aria-current={ativa ? 'step' : undefined}
          >
            <span className="camp-form-step-marker">
              {concluida ? <Check size={14} aria-hidden="true" /> : index + 1}
            </span>
            <span className="camp-form-step-label">{etapa.label}</span>
          </div>
        )
      })}
    </nav>
  )
}

function OpcaoCard({ checked, onChange, children, disabled = false }) {
  return (
    <label className={`camp-choice${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span>{children}</span>
    </label>
  )
}

function EscadaEditor({ degraus, setDegraus, passoExtra, setPassoExtra, giro, setGiro }) {
  const alterar = (id, campo, valor) => {
    setDegraus(degraus.map(d => (d.id === id ? { ...d, [campo]: valor } : d)))
  }

  return (
    <div className="camp-prize-editor">
      <div className="camp-field-heading">
        <div>
          <h3>Escada cumulativa</h3>
          <p>Ao atingir o marco, o consultor acumula aquele prêmio e os anteriores.</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost camp-btn-compact"
          onClick={() => setDegraus([...degraus, linhaVazia()])}
        >
          <Plus size={15} aria-hidden="true" />
          Adicionar marco
        </button>
      </div>

      <div className="camp-ladder-editor">
        <div className="camp-ladder-head" aria-hidden="true">
          <span>Marco</span>
          <span>Prêmio</span>
          <span />
        </div>
        {degraus.map((d, index) => (
          <div className="camp-ladder-row" key={d.id}>
            <label className="field-group">
              <span className="field-label camp-mobile-label">Contratos</span>
              <div className="camp-input-affix">
                <input
                  className="field-input"
                  type="number"
                  min="1"
                  value={d.at}
                  onChange={e => alterar(d.id, 'at', e.target.value)}
                  placeholder={String((index + 1) * 5)}
                  aria-label={`Contratos do marco ${index + 1}`}
                />
                <span>contratos</span>
              </div>
            </label>
            <label className="field-group">
              <span className="field-label camp-mobile-label">Prêmio</span>
              <div className="camp-input-affix is-money">
                <span>R$</span>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={d.prize}
                  onChange={e => alterar(d.id, 'prize', e.target.value)}
                  placeholder="20"
                  aria-label={`Prêmio do marco ${index + 1}`}
                />
              </div>
            </label>
            <button
              type="button"
              className="camp-icon-btn is-danger"
              aria-label={`Remover marco ${index + 1}`}
              onClick={() => setDegraus(
                degraus.length === 1 ? [linhaVazia()] : degraus.filter(item => item.id !== d.id)
              )}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="camp-form-grid camp-form-grid-2 camp-prize-extras">
        <div className="field-group">
          <label className="field-label" htmlFor="camp-extra-every">Após o último marco</label>
          <div className="camp-inline-fields">
            <div className="camp-input-affix">
              <input
                id="camp-extra-every"
                className="field-input"
                type="number"
                min="1"
                value={passoExtra.every}
                onChange={e => setPassoExtra({ ...passoExtra, every: e.target.value })}
                placeholder="5"
              />
              <span>contratos</span>
            </div>
            <div className="camp-input-affix is-money">
              <span>R$</span>
              <input
                className="field-input"
                type="number"
                min="0"
                step="0.01"
                value={passoExtra.prize}
                onChange={e => setPassoExtra({ ...passoExtra, prize: e.target.value })}
                placeholder="20"
                aria-label="Prêmio adicional"
              />
            </div>
          </div>
          <span className="field-hint">Repete esta recompensa depois do último marco.</span>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="camp-spin">Giros de roleta</label>
          <div className="camp-input-affix">
            <input
              id="camp-spin"
              className="field-input"
              type="number"
              min="1"
              value={giro}
              onChange={e => setGiro(e.target.value)}
              placeholder="5"
            />
            <span>contratos por giro</span>
          </div>
          <span className="field-hint">Deixe vazio se a campanha não usar roleta.</span>
        </div>
      </div>
    </div>
  )
}

function Resumo({ nome, subtitulo, inicio, fim, produtos, mesmoDia, abrangencia, degraus, passoExtra, giro }) {
  const produtoNomes = PRODUTOS.filter(p => produtos.includes(p.id)).map(p => p.nome).join(', ')
  const completos = degraus.filter(d => d.at !== '' && d.prize !== '')
  const data = valor => valor
    ? new Date(`${valor}T12:00:00`).toLocaleDateString('pt-BR')
    : 'Não definida'

  return (
    <div className="camp-review">
      <div className="camp-review-hero">
        <span>Prévia da campanha</span>
        <h3>{nome || 'Campanha sem nome'}</h3>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </div>
      <dl className="camp-review-grid">
        <div><dt>Período</dt><dd>{data(inicio)} a {data(fim || inicio)}</dd></div>
        <div><dt>Participantes</dt><dd>{abrangencia}</dd></div>
        <div><dt>Produtos</dt><dd>{produtoNomes || 'Nenhum selecionado'}</dd></div>
        <div><dt>Regra de pagamento</dt><dd>{mesmoDia ? 'Digitado e pago no mesmo dia' : 'Todos os pagos no dia'}</dd></div>
        <div>
          <dt>Escada</dt>
          <dd>{completos.length ? `${completos.length} marco${completos.length === 1 ? '' : 's'}` : 'Sem prêmio automático'}</dd>
        </div>
        <div>
          <dt>Continuidade</dt>
          <dd>
            {passoExtra.every && passoExtra.prize
              ? `R$ ${Number(passoExtra.prize).toLocaleString('pt-BR')} a cada ${passoExtra.every}`
              : 'Sem prêmio recorrente'}
            {giro ? ` · 1 giro a cada ${giro}` : ''}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function CampaignForm({ campaign = null, onCriada, onSaved, onCancelar }) {
  const { user } = useAuth()
  const isMaster = user?.role === 'admin'
  const editando = Boolean(campaign?.id)
  const formRef = useRef(null)

  const [etapa, setEtapa] = useState(0)
  const [salvando, setSalvando] = useState('')
  const [erros, setErros] = useState({})
  const [erroGeral, setErroGeral] = useState('')

  const [nome, setNome] = useState('')
  const [subtitulo, setSubtitulo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [produtos, setProdutos] = useState(['13'])
  const [mesmoDia, setMesmoDia] = useState(false)
  const [selecionadas, setSelecionadas] = useState([])
  const [todasAsFranquias, setTodasAsFranquias] = useState(false)
  const [buscaFranquia, setBuscaFranquia] = useState('')
  const [degraus, setDegraus] = useState([linhaVazia()])
  const [passoExtra, setPassoExtra] = useState({ every: '', prize: '' })
  const [giro, setGiro] = useState('')

  const [franquias, setFranquias] = useState([])
  const [carregandoFranquias, setCarregandoFranquias] = useState(true)
  const [erroCatalogo, setErroCatalogo] = useState('')

  useEffect(() => {
    setNome(campaign?.name || '')
    setSubtitulo(campaign?.subtitle || '')
    setInicio(campaign?.start_date || '')
    setFim(campaign?.end_date || campaign?.start_date || '')
    setProdutos(Array.isArray(campaign?.product_ids) && campaign.product_ids.length ? campaign.product_ids : ['13'])
    setMesmoDia(Boolean(campaign?.require_same_day))
    setSelecionadas(Array.isArray(campaign?.franquia_ids) ? campaign.franquia_ids : [])
    setTodasAsFranquias(editando && (!campaign?.franquia_ids || campaign.franquia_ids.length === 0))
    setDegraus(normalizarDegraus(campaign))
    setPassoExtra({
      every: String(campaign?.ladder_step?.every ?? ''),
      prize: String(campaign?.ladder_step?.prize ?? ''),
    })
    setGiro(String(campaign?.spin_every ?? ''))
    setEtapa(0)
    setErros({})
    setErroGeral('')
  }, [campaign, editando])

  // Campanha já criada pode apontar para franquia que saiu de operação e por
  // isso não vem mais no catálogo. Pedimos esses ids de volta: sem eles a linha
  // some da tela mas continua em `selecionadas`, viajando no PUT sem ninguém
  // enxergar nem poder desmarcar.
  const incluir = useMemo(
    () => (Array.isArray(campaign?.franquia_ids) ? campaign.franquia_ids : []).join(','),
    [campaign]
  )

  useEffect(() => {
    let ativo = true
    setCarregandoFranquias(true)
    api.get('/franquias', { params: incluir ? { incluir } : {} })
      .then(r => {
        if (!ativo) return
        setFranquias(r.data?.franquias || [])
        setErroCatalogo('')
      })
      .catch(e => {
        if (!ativo) return
        setErroCatalogo(e.response?.data?.error || 'Não foi possível carregar as franquias')
      })
      .finally(() => { if (ativo) setCarregandoFranquias(false) })
    return () => { ativo = false }
  }, [incluir])

  useEffect(() => {
    if (!Object.keys(erros).length) return
    formRef.current?.querySelector('[aria-invalid="true"], [role="alert"]')?.focus?.()
  }, [erros, etapa])

  const franquiasDoDono = useMemo(
    () => franquias.filter(f => (user?.managed_franquia_ids || []).includes(f.id)),
    [franquias, user]
  )

  const franquiasFiltradas = useMemo(() => {
    const termo = buscaFranquia.trim().toLocaleLowerCase('pt-BR')
    if (!termo) return franquias
    return franquias.filter(f => String(f.nome || '').toLocaleLowerCase('pt-BR').includes(termo))
  }, [franquias, buscaFranquia])

  const nomesSelecionados = useMemo(() => {
    if (todasAsFranquias) return 'Empresa inteira'
    const nomes = selecionadas.map(id => franquias.find(f => f.id === id)?.nome || id)
    return nomes.length ? nomes.join(', ') : 'Nenhuma franquia selecionada'
  }, [franquias, selecionadas, todasAsFranquias])

  const abrangenciaResumo = isMaster
    ? nomesSelecionados
    : (franquiasDoDono.length
        ? franquiasDoDono.map(f => f.nome).join(', ')
        : 'Nenhuma franquia vinculada')

  const alternarLista = (lista, setLista, id) => {
    setLista(lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id])
  }

  const validar = indice => {
    const novos = {}
    if (indice === 0) {
      if (!nome.trim()) novos.nome = 'Informe um nome para a campanha.'
      if (!inicio) novos.inicio = 'Informe o dia que o placar deve mostrar.'
      if (inicio && fim && fim < inicio) novos.fim = 'O término não pode ser antes do início.'
    }
    if (indice === 1) {
      if (!produtos.length) novos.produtos = 'Selecione ao menos um produto.'
      if (isMaster && !todasAsFranquias && !selecionadas.length) {
        novos.franquias = 'Selecione as franquias ou marque empresa inteira.'
      }
      if (!isMaster && !(user?.managed_franquia_ids || []).length) {
        novos.franquias = 'Sua conta não está vinculada a nenhuma franquia.'
      }
    }
    if (indice === 2) {
      const incompleto = degraus.some(d => (d.at === '') !== (d.prize === ''))
      const marcos = degraus.filter(d => d.at !== '' && d.prize !== '').map(d => Number(d.at))
      if (incompleto) novos.premios = 'Complete ou remova os marcos preenchidos pela metade.'
      if (new Set(marcos).size !== marcos.length) novos.premios = 'Cada marco precisa ter uma quantidade diferente.'
      if ((passoExtra.every === '') !== (passoExtra.prize === '')) {
        novos.premios = 'Complete os dois campos do prêmio recorrente.'
      }
    }
    setErros(novos)
    if (Object.keys(novos).length) return false
    return true
  }

  const avancar = () => {
    if (!validar(etapa)) return
    setEtapa(atual => Math.min(atual + 1, ETAPAS.length - 1))
    setErros({})
    setErroGeral('')
  }

  const voltar = () => {
    setEtapa(atual => Math.max(0, atual - 1))
    setErros({})
    setErroGeral('')
  }

  const montarEscada = () => degraus
    .filter(d => d.at !== '' && d.prize !== '')
    .map(d => ({ at: Number(d.at), prize: Number(d.prize) }))
    .filter(d => d.at > 0)
    .sort((a, b) => a.at - b.at)

  const salvar = async statusInicial => {
    for (let i = 0; i < ETAPAS.length - 1; i += 1) {
      if (!validar(i)) {
        setEtapa(i)
        return
      }
    }

    const temPassoExtra = passoExtra.every && passoExtra.prize
    const payload = {
      name: nome.trim(),
      subtitle: subtitulo.trim() || null,
      start_date: inicio,
      end_date: fim || inicio,
      product_ids: produtos,
      require_same_day: mesmoDia,
      ladder: montarEscada(),
      ladder_step: temPassoExtra
        ? { every: Number(passoExtra.every), prize: Number(passoExtra.prize) }
        : null,
      spin_every: giro ? Number(giro) : null,
      ...(isMaster ? { franquia_ids: todasAsFranquias ? [] : selecionadas } : {}),
      ...(!editando ? { status: statusInicial } : {}),
    }

    setSalvando(editando ? 'save' : statusInicial)
    setErroGeral('')
    try {
      const { data } = editando
        ? await api.put(`/campaigns/${campaign.id}`, payload)
        : await api.post('/campaigns', payload)
      showToast(
        editando
          ? 'Campanha atualizada'
          : statusInicial === 'active'
            ? 'Campanha criada e ativada'
            : 'Rascunho salvo'
      )
      onSaved?.(data)
      onCriada?.(data)
    } catch (e) {
      const mensagem = e.response?.data?.error || 'Não foi possível salvar a campanha'
      setErroGeral(mensagem)
      showToast(mensagem, false)
    } finally {
      setSalvando('')
    }
  }

  const periodoMaiorQueUmDia = inicio && fim && inicio !== fim

  return (
    <section className="camp-form-shell" ref={formRef} aria-labelledby="camp-form-title">
      <header className="camp-form-header">
        <div>
          <span className="camp-form-kicker">{editando ? 'Editar campanha' : 'Nova campanha'}</span>
          <h2 id="camp-form-title">{editando ? campaign.name : 'Configure a próxima disputa'}</h2>
          <p>Defina apenas regras que o placar consegue medir hoje.</p>
        </div>
        <button type="button" className="camp-icon-btn" onClick={onCancelar} aria-label="Fechar formulário">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <Stepper atual={etapa} />

      <div className="camp-form-body">
        {erroGeral ? <div className="camp-alert is-error" role="alert" tabIndex="-1">{erroGeral}</div> : null}

        {etapa === 0 ? (
          <div className="camp-form-section">
            <div className="camp-section-heading">
              <h3>Como a campanha será reconhecida?</h3>
              <p>O nome e a frase aparecem na listagem e no telão.</p>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="camp-name">Nome da campanha</label>
              <input
                id="camp-name"
                className="field-input"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Missão Resgate Tatuapé"
                aria-invalid={Boolean(erros.nome)}
                aria-describedby={erros.nome ? 'camp-name-error' : undefined}
              />
              {erros.nome ? <span className="camp-field-error" id="camp-name-error" role="alert">{erros.nome}</span> : null}
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="camp-subtitle">Frase da campanha <span>(opcional)</span></label>
              <input
                id="camp-subtitle"
                className="field-input"
                value={subtitulo}
                onChange={e => setSubtitulo(e.target.value)}
                placeholder="Uma chamada curta para quem está no telão"
              />
              <span className="field-hint">Use uma frase curta; detalhes operacionais ficam fora do telão.</span>
            </div>
            <div className="camp-form-grid camp-form-grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="camp-start">Dia do placar</label>
                <input
                  id="camp-start"
                  type="date"
                  className="field-input"
                  value={inicio}
                  onChange={e => setInicio(e.target.value)}
                  aria-invalid={Boolean(erros.inicio)}
                  aria-describedby={erros.inicio ? 'camp-start-error' : undefined}
                />
                {erros.inicio ? <span className="camp-field-error" id="camp-start-error" role="alert">{erros.inicio}</span> : null}
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="camp-end">Término</label>
                <input
                  id="camp-end"
                  type="date"
                  className="field-input"
                  value={fim}
                  onChange={e => setFim(e.target.value)}
                  aria-invalid={Boolean(erros.fim)}
                  aria-describedby={erros.fim ? 'camp-end-error' : undefined}
                />
                {erros.fim ? <span className="camp-field-error" id="camp-end-error" role="alert">{erros.fim}</span> : null}
              </div>
            </div>
            {periodoMaiorQueUmDia ? (
              <div className="camp-alert is-warning">
                <Info size={18} aria-hidden="true" />
                <div>
                  <strong>O placar mostra somente o dia de início.</strong>
                  <span>Até a soma de período ser implementada, prefira campanhas de um dia.</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {etapa === 1 ? (
          <div className="camp-form-section">
            <div className="camp-section-heading">
              <h3>Quem participa e o que conta?</h3>
              <p>A abrangência do franqueado é protegida novamente pelo servidor.</p>
            </div>

            <div className="camp-field-block">
              <div className="camp-field-heading">
                <div>
                  <h3>Participantes</h3>
                  <p>Escolha a empresa inteira ou franquias específicas.</p>
                </div>
              </div>

              {carregandoFranquias ? (
                <div className="camp-inline-state">Carregando franquias…</div>
              ) : erroCatalogo ? (
                <div className="camp-alert is-error" role="alert">{erroCatalogo}</div>
              ) : isMaster ? (
                <>
                  <OpcaoCard
                    checked={todasAsFranquias}
                    onChange={e => setTodasAsFranquias(e.target.checked)}
                  >
                    <strong>Empresa inteira</strong>
                    <small>Todas as franquias e a matriz</small>
                  </OpcaoCard>
                  {!todasAsFranquias ? (
                    <>
                      <label className="camp-search" htmlFor="camp-franchise-search">
                        <Search size={16} aria-hidden="true" />
                        <input
                          id="camp-franchise-search"
                          value={buscaFranquia}
                          onChange={e => setBuscaFranquia(e.target.value)}
                          placeholder="Buscar franquia"
                        />
                      </label>
                      <div className="camp-choice-grid">
                        {franquiasFiltradas.map(f => (
                          <OpcaoCard
                            key={f.id}
                            checked={selecionadas.includes(f.id)}
                            onChange={() => alternarLista(selecionadas, setSelecionadas, f.id)}
                          >
                            <strong>{f.nome}</strong>
                            <small>{f.consultores} consultor{f.consultores === 1 ? '' : 'es'}</small>
                          </OpcaoCard>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <div className={`camp-scope-readonly${franquiasDoDono.length ? '' : ' is-error'}`}>
                  <strong>{franquiasDoDono.length ? abrangenciaResumo : 'Nenhuma franquia vinculada'}</strong>
                  <span>
                    {franquiasDoDono.length
                      ? 'A campanha será limitada ao seu escopo.'
                      : 'Peça à matriz para configurar o acesso antes de criar.'}
                  </span>
                </div>
              )}
              {erros.franquias ? <span className="camp-field-error" role="alert" tabIndex="-1">{erros.franquias}</span> : null}
            </div>

            <div className="camp-field-block">
              <div className="camp-field-heading">
                <div><h3>Produtos</h3><p>O ranking considera apenas os produtos selecionados.</p></div>
              </div>
              <div className="camp-choice-grid is-compact">
                {PRODUTOS.map(produto => (
                  <OpcaoCard
                    key={produto.id}
                    checked={produtos.includes(produto.id)}
                    onChange={() => alternarLista(produtos, setProdutos, produto.id)}
                  >
                    <strong>{produto.nome}</strong>
                    <small>Código {produto.id}</small>
                  </OpcaoCard>
                ))}
              </div>
              {erros.produtos ? <span className="camp-field-error" role="alert" tabIndex="-1">{erros.produtos}</span> : null}
            </div>

            <div className="camp-rule-toggle">
              <label>
                <input type="checkbox" checked={mesmoDia} onChange={e => setMesmoDia(e.target.checked)} />
                <span>
                  <strong>Exigir pagamento no mesmo dia</strong>
                  <small>Só conta contrato digitado e pago na mesma data.</small>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {etapa === 2 ? (
          <div className="camp-form-section">
            <div className="camp-section-heading">
              <h3>Como a campanha recompensa?</h3>
              <p>Premiação é opcional. O telão destaca giros e progresso; os valores ficam no painel.</p>
            </div>
            {erros.premios ? <div className="camp-alert is-error" role="alert" tabIndex="-1">{erros.premios}</div> : null}
            <EscadaEditor
              degraus={degraus}
              setDegraus={setDegraus}
              passoExtra={passoExtra}
              setPassoExtra={setPassoExtra}
              giro={giro}
              setGiro={setGiro}
            />
          </div>
        ) : null}

        {etapa === 3 ? (
          <div className="camp-form-section">
            <div className="camp-section-heading">
              <h3>Revise antes de salvar</h3>
              <p>Você poderá editar estes dados depois, respeitando as permissões da campanha.</p>
            </div>
            <Resumo
              nome={nome}
              subtitulo={subtitulo}
              inicio={inicio}
              fim={fim}
              produtos={produtos}
              mesmoDia={mesmoDia}
              abrangencia={abrangenciaResumo}
              degraus={degraus}
              passoExtra={passoExtra}
              giro={giro}
            />
            {!editando ? (
              <div className="camp-alert is-info">
                <Info size={18} aria-hidden="true" />
                <div>
                  <strong>Rascunho ou ativação imediata?</strong>
                  <span>Rascunhos só aparecem para administradores e franqueados envolvidos.</span>
                </div>
              </div>
            ) : campaign?.status === 'closed' ? (
              <div className="camp-alert is-warning">
                <Info size={18} aria-hidden="true" />
                <div>
                  <strong>Esta campanha já está encerrada e tem resultado salvo.</strong>
                  <span>Mudar período, produtos ou premiação aqui não altera o placar já congelado — clique em “Recongelar resultado” na lista depois de salvar para aplicar.</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="camp-form-footer">
        <div className="camp-form-footer-left">
          {etapa > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={voltar} disabled={Boolean(salvando)}>
              <ArrowLeft size={15} aria-hidden="true" />
              Voltar
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={Boolean(salvando)}>
            Cancelar
          </button>
        </div>
        {etapa < ETAPAS.length - 1 ? (
          <button type="button" className="btn btn-gold" onClick={avancar}>
            Continuar
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        ) : editando ? (
          <button type="button" className="btn btn-gold" onClick={() => salvar()} disabled={Boolean(salvando)}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
        ) : (
          <div className="camp-form-submit">
            <button type="button" className="btn btn-ghost" onClick={() => salvar('draft')} disabled={Boolean(salvando)}>
              {salvando === 'draft' ? 'Salvando…' : 'Salvar rascunho'}
            </button>
            <button type="button" className="btn btn-gold" onClick={() => salvar('active')} disabled={Boolean(salvando)}>
              {salvando === 'active' ? 'Ativando…' : 'Criar e ativar'}
            </button>
          </div>
        )}
      </footer>
    </section>
  )
}
