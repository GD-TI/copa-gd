import { useState, useEffect, useMemo } from 'react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../utils/toast'

/**
 * Criação de campanha, em três passos.
 *
 * Só oferece o que o placar **realmente calcula hoje**: identidade, período,
 * produto, "digitado e pago no mesmo dia", abrangência e escada de prêmios.
 *
 * Campos deixados de fora de propósito, para o formulário não mentir:
 *   `metric`      — é gravado no banco e nunca lido; o placar sempre ordena por
 *                   contratos. Entra quando passar a valer (Fase 3).
 *   `color`       — não tem nenhuma regra de estilo consumindo hoje.
 *   metas e prêmio por colocação — ainda não existem no cálculo (Fase 3 e 4).
 *
 * A abrangência aparece como escolha só para a matriz. Para o dono de franquia
 * ela é exibida e não editável — e, mais importante, o servidor a impõe de novo
 * na criação, ignorando o que vier no corpo (services/campaignAccess.js).
 */

const PRODUTOS = [
  { id: '13', nome: 'Crédito do Trabalhador (CLT)' },
  { id: '7',  nome: 'Produto 7' },
]

const PASSOS = ['Identidade', 'Abrangência e regras', 'Prêmios']

const linhaVazia = () => ({ at: '', prize: '' })

function BarraDePassos({ passo }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
      {PASSOS.map((label, i) => {
        const n = i + 1
        const estado = n < passo ? 'feito' : n === passo ? 'atual' : 'futuro'
        return (
          <div key={label} style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              height: 3, borderRadius: 2, marginBottom: 6,
              background: estado === 'futuro' ? 'var(--border)' : 'var(--gold)',
            }} />
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: .4,
              color: estado === 'atual' ? 'var(--txt)' : 'var(--txt3)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {n}. {label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Escada de prêmios: "chegou a N contratos, ganha R$ X" (cumulativa). */
function EscadaEditor({ degraus, setDegraus, passo, setPasso, giro, setGiro }) {
  const alterar = (i, campo, valor) =>
    setDegraus(degraus.map((d, idx) => (idx === i ? { ...d, [campo]: valor } : d)))

  return (
    <>
      <div className="field-label" style={{ marginBottom: 8 }}>Escada de prêmios</div>

      {degraus.map((d, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--txt3)', width: 58 }}>chegou a</span>
          <input
            className="field-input" type="number" min="1" style={{ width: 90 }}
            value={d.at} onChange={e => alterar(i, 'at', e.target.value)} placeholder="5"
          />
          <span style={{ fontSize: 12, color: 'var(--txt3)' }}>contratos → R$</span>
          <input
            className="field-input" type="number" min="0" step="0.01" style={{ width: 110 }}
            value={d.prize} onChange={e => alterar(i, 'prize', e.target.value)} placeholder="20"
          />
          <button
            type="button" className="btn btn-ghost" style={{ fontSize: 11 }}
            onClick={() => setDegraus(degraus.filter((_, idx) => idx !== i))}
          >
            remover
          </button>
        </div>
      ))}

      <button
        type="button" className="btn btn-ghost" style={{ fontSize: 12, marginBottom: 16 }}
        onClick={() => setDegraus([...degraus, linhaVazia()])}
      >
        ➕ Adicionar degrau
      </button>

      <div className="cfg-2col" style={{ marginBottom: 12 }}>
        <div className="field-group">
          <label className="field-label">Depois do último degrau, a cada</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="field-input" type="number" min="1" style={{ width: 90 }}
              value={passo.every} onChange={e => setPasso({ ...passo, every: e.target.value })} placeholder="5"
            />
            <span style={{ fontSize: 12, color: 'var(--txt3)' }}>contratos → R$</span>
            <input
              className="field-input" type="number" min="0" step="0.01" style={{ width: 110 }}
              value={passo.prize} onChange={e => setPasso({ ...passo, prize: e.target.value })} placeholder="20"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">1 giro de roleta a cada N contratos</label>
          <input
            className="field-input" type="number" min="1" style={{ width: 110 }}
            value={giro} onChange={e => setGiro(e.target.value)} placeholder="5"
          />
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
        A escada é cumulativa: quem chega a 15 já ganhou os prêmios de 5 e 10. Deixe em branco
        para uma campanha sem prêmio automático.
      </div>
    </>
  )
}

export default function CampaignForm({ onCriada, onCancelar }) {
  const { user } = useAuth()
  const isMaster = user?.role === 'admin'

  const [passo, setPasso] = useState(1)
  const [salvando, setSalvando] = useState(false)

  // 1 · Identidade
  const [nome, setNome] = useState('')
  const [subtitulo, setSubtitulo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')

  // 2 · Abrangência e regras
  const [franquias, setFranquias] = useState([])
  const [erroCatalogo, setErroCatalogo] = useState('')
  const [selecionadas, setSelecionadas] = useState([])
  const [todasAsFranquias, setTodasAsFranquias] = useState(false)
  const [produtos, setProdutos] = useState(['13'])
  const [mesmoDia, setMesmoDia] = useState(false)

  // 3 · Prêmios
  const [degraus, setDegraus] = useState([linhaVazia()])
  const [passoExtra, setPassoExtra] = useState({ every: '', prize: '' })
  const [giro, setGiro] = useState('')

  useEffect(() => {
    api.get('/franquias')
      .then(r => { setFranquias(r.data?.franquias || []); setErroCatalogo('') })
      .catch(e => setErroCatalogo(e.response?.data?.error || 'Não foi possível ler as franquias do NewCorban'))
  }, [])

  // O placar de hoje é de um dia só (start_date). Campanha com período maior
  // mostraria apenas o primeiro dia — soma do período é a Fase 2.
  const avisoDePeriodo = fim && inicio && fim !== inicio

  const franquiasDoDono = useMemo(
    () => franquias.filter(f => (user?.managed_franquia_ids || []).includes(f.id)),
    [franquias, user]
  )

  const alternar = (lista, setLista, id) =>
    setLista(lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id])

  const validarPasso = () => {
    if (passo === 1) {
      if (!nome.trim()) return 'Dê um nome à campanha'
      if (!inicio) return 'Informe a data de início — é o dia que o placar mostra'
      if (fim && fim < inicio) return 'A data de término não pode ser antes do início'
    }
    if (passo === 2) {
      if (!produtos.length) return 'Selecione ao menos um produto'
      if (isMaster && !todasAsFranquias && !selecionadas.length) {
        return 'Escolha as franquias ou marque "todas"'
      }
      if (!isMaster && !franquiasDoDono.length && !(user?.managed_franquia_ids || []).length) {
        return 'Sua conta não está vinculada a nenhuma franquia. Peça à matriz para configurar o acesso.'
      }
    }
    return null
  }

  const avancar = () => {
    const erro = validarPasso()
    if (erro) return showToast(erro, false)
    setPasso(p => Math.min(p + 1, PASSOS.length))
  }

  /** Só degraus completos viram escada — linha pela metade é engano, não regra. */
  const montarEscada = () => degraus
    .filter(d => String(d.at).trim() !== '' && String(d.prize).trim() !== '')
    .map(d => ({ at: Number(d.at), prize: Number(d.prize) }))
    .filter(d => d.at > 0)
    .sort((a, b) => a.at - b.at)

  const criar = async () => {
    const erro = validarPasso()
    if (erro) return showToast(erro, false)

    const ladder = montarEscada()
    const temPassoExtra = passoExtra.every && passoExtra.prize

    setSalvando(true)
    try {
      const { data } = await api.post('/campaigns', {
        name: nome.trim(),
        subtitle: subtitulo.trim() || null,
        start_date: inicio,
        end_date: fim || inicio,
        product_ids: produtos,
        require_same_day: mesmoDia,
        // A matriz manda a escolha; o servidor ignora este campo para o dono de
        // franquia e usa o escopo dele.
        franquia_ids: isMaster && !todasAsFranquias ? selecionadas : [],
        ladder,
        ladder_step: temPassoExtra
          ? { every: Number(passoExtra.every), prize: Number(passoExtra.prize) }
          : null,
        spin_every: giro ? Number(giro) : null,
      })
      showToast('Campanha criada como rascunho — clique em Ativar quando ela valer')
      onCriada?.(data)
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao criar campanha', false)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>
        Nova campanha
      </div>

      <BarraDePassos passo={passo} />

      {passo === 1 && (
        <>
          <div className="field-group" style={{ marginBottom: 12 }}>
            <label className="field-label">Nome</label>
            <input className="field-input" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Missão Resgate Tatuapé" />
          </div>
          <div className="field-group" style={{ marginBottom: 12 }}>
            <label className="field-label">Frase da campanha (opcional)</label>
            <input className="field-input" value={subtitulo} onChange={e => setSubtitulo(e.target.value)} placeholder="aparece abaixo do nome no telão" />
          </div>
          <div className="cfg-2col">
            <div className="field-group">
              <label className="field-label">Início</label>
              <input type="date" className="field-input" value={inicio} onChange={e => setInicio(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Término</label>
              <input type="date" className="field-input" value={fim} onChange={e => setFim(e.target.value)} />
            </div>
          </div>

          {avisoDePeriodo && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(217,119,6,.12)', border: '1px solid rgba(217,119,6,.35)', fontSize: 12, color: 'var(--txt2)' }}>
              ⚠️ <strong>Nesta versão o placar mostra apenas o dia de início.</strong> A soma do
              período inteiro está na próxima etapa do projeto — até lá, prefira campanha de um dia.
            </div>
          )}
        </>
      )}

      {passo === 2 && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div className="field-label" style={{ marginBottom: 8 }}>Quem participa</div>

            {erroCatalogo ? (
              <div style={{ fontSize: 12, color: 'var(--red)' }}>{erroCatalogo}</div>
            ) : isMaster ? (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={todasAsFranquias} onChange={e => setTodasAsFranquias(e.target.checked)} />
                  Todas as franquias (empresa inteira)
                </label>

                {!todasAsFranquias && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {franquias.map(f => (
                      <label
                        key={f.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer',
                          padding: '6px 10px', background: 'var(--surf2)', borderRadius: 8,
                          border: selecionadas.includes(f.id) ? '1px solid var(--gold)' : '1px solid var(--border)',
                        }}
                      >
                        <input
                          type="checkbox" checked={selecionadas.includes(f.id)}
                          onChange={() => alternar(selecionadas, setSelecionadas, f.id)}
                        />
                        {f.nome}
                        <span style={{ color: f.consultores ? 'var(--txt3)' : 'var(--red)' }}>
                          ({f.consultores} consultores)
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--txt2)' }}>
                {franquiasDoDono.length
                  ? <>Sua franquia: <strong>{franquiasDoDono.map(f => `${f.nome} (${f.consultores} consultores)`).join(' · ')}</strong></>
                  : <span style={{ color: 'var(--red)' }}>Sua conta não está vinculada a nenhuma franquia. Peça à matriz para configurar o acesso.</span>}
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 6 }}>
                  Campanha para várias franquias é criada pela matriz.
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="field-label" style={{ marginBottom: 8 }}>Produto</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRODUTOS.map(p => (
                <label
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer',
                    padding: '6px 10px', background: 'var(--surf2)', borderRadius: 8,
                    border: produtos.includes(p.id) ? '1px solid var(--gold)' : '1px solid var(--border)',
                  }}
                >
                  <input type="checkbox" checked={produtos.includes(p.id)} onChange={() => alternar(produtos, setProdutos, p.id)} />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={mesmoDia} onChange={e => setMesmoDia(e.target.checked)} />
            Só conta contrato <strong>digitado e pago no mesmo dia</strong>
          </label>
        </>
      )}

      {passo === 3 && (
        <EscadaEditor
          degraus={degraus} setDegraus={setDegraus}
          passo={passoExtra} setPasso={setPassoExtra}
          giro={giro} setGiro={setGiro}
        />
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        {passo > 1 && (
          <button type="button" className="btn btn-ghost" onClick={() => setPasso(p => p - 1)}>← Voltar</button>
        )}
        {passo < PASSOS.length ? (
          <button type="button" className="btn btn-gold" onClick={avancar}>Próximo →</button>
        ) : (
          <button type="button" className="btn btn-gold" onClick={criar} disabled={salvando}>
            {salvando ? 'Criando…' : '✅ Criar campanha'}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onCancelar} style={{ marginLeft: 'auto' }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
