import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { RankingLista, RankingResumo } from '../components/RankingIndividual'
import TelaoRankings from '../components/TelaoRankings'

const hojeBR = () => new Date().toLocaleDateString('en-CA')

function rotuloDia(dia) {
  if (dia === hojeBR()) return 'Hoje'
  const d = new Date(dia + 'T12:00:00')
  return isNaN(d) ? dia : d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}

/** Dia útil anterior não interessa aqui — o ranking conta todo dia, igual ao da NC. */
function somaDias(dia, n) {
  const d = new Date(dia + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Contratos digitados no dia, por quantidade — empresa inteira, sem robôs.
 *
 * Zera todo dia porque a janela da consulta é o dia: à meia-noite a lista já
 * começa vazia sozinha, sem cron nem tabela para limpar.
 */
export default function ShellRankingToday({ ativo = true }) {
  const [dia, setDia]         = useState(hojeBR())
  const [dados, setDados]     = useState(null)
  const [erro, setErro]       = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [atualizado, setAtualizado] = useState(null)
  const [telaoAberto, setTelaoAberto] = useState(false)

  const carregar = useCallback(async (d) => {
    setCarregando(true)
    setErro(null)
    try {
      const r = await api.get(`/rankings/digitados?date=${d}`)
      setDados(r.data)
      setAtualizado(new Date())
    } catch (e) {
      setDados(null)
      setErro(e.response?.data?.detail || e.message)
    }
    setCarregando(false)
  }, [])

  useEffect(() => { carregar(dia) }, [dia, carregar])

  // Só o dia corrente recebe contrato novo.
  useEffect(() => {
    if (!ativo || dia !== hojeBR()) return
    const t = setInterval(() => carregar(dia), 60000)
    return () => clearInterval(t)
  }, [ativo, dia, carregar])

  const ehHoje = dia === hojeBR()

  return (
    <div className="ri-page">
      {telaoAberto && (
        <TelaoRankings inicial="digitados" digitados={dados} onClose={() => setTelaoAberto(false)} />
      )}

      <div className="ri-page-head">
        <div className="ri-page-titulo">
          <h2>⌨️ Digitados do Dia</h2>
          <span className="ri-page-sub">
            Contratos digitados em {rotuloDia(dia).toLowerCase()} · empresa inteira
          </span>
        </div>
        <div className="ri-dia-nav">
          <button className="ri-dia-btn" onClick={() => setDia(d => somaDias(d, -1))} title="Dia anterior">‹</button>
          <span className="ri-dia-atual">{rotuloDia(dia)}</span>
          <button
            className="ri-dia-btn"
            onClick={() => setDia(d => somaDias(d, 1))}
            disabled={ehHoje}
            title="Próximo dia"
          >›</button>
          {!ehHoje && (
            <button className="ri-dia-hoje" onClick={() => setDia(hojeBR())}>Voltar para hoje</button>
          )}
          {ehHoje && atualizado && (
            <span className="ri-dia-hora">
              {atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="telao-open-btn" onClick={() => setTelaoAberto(true)}>
            📺 Telão
          </button>
        </div>
      </div>

      {erro
        ? <div className="ri-estado">Não foi possível carregar: {erro}</div>
        : (
          <>
            <RankingResumo dados={carregando ? null : dados} unidade="digitados" />
            <RankingLista
              dados={carregando ? null : dados}
              variante="digitados"
              vazio={ehHoje ? 'Nenhum contrato digitado hoje ainda' : 'Nenhum contrato digitado neste dia'}
            />
          </>
        )
      }
    </div>
  )
}
