import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { RankingLista, RankingResumo, nomeDoMes } from '../components/RankingIndividual'

/**
 * Ranking individual do mês, por R$ pago — empresa inteira, sem robôs.
 *
 * Não há reset: a janela é o mês, então dia 1º a lista já começa vazia sozinha.
 * O mês corrente vem ao vivo da NewCorban; mês encerrado vem da foto congelada
 * em `monthly_rankings` e não muda mais.
 */
export default function ShellRankingIndividual({ ativo = true }) {
  const [meses, setMeses]       = useState([])
  const [mesAtivo, setMesAtivo] = useState(null)
  const [dados, setDados]       = useState(null)
  const [erro, setErro]         = useState(null)
  const [carregando, setCarregando] = useState(true)

  // Lista de meses: o corrente e os já congelados
  useEffect(() => {
    api.get('/rankings/meses')
      .then(r => {
        setMeses(r.data.meses || [])
        setMesAtivo(m => m || r.data.atual)
      })
      .catch(() => setMesAtivo(m => m || new Date().toLocaleDateString('en-CA').slice(0, 7)))
  }, [])

  const carregar = useCallback(async (mes) => {
    if (!mes) return
    setCarregando(true)
    setErro(null)
    try {
      const r = await api.get(`/rankings/mensal?mes=${mes}`)
      setDados(r.data)
    } catch (e) {
      setDados(null)
      setErro(e.response?.data?.detail || e.message)
    }
    setCarregando(false)
  }, [])

  useEffect(() => { carregar(mesAtivo) }, [mesAtivo, carregar])

  // Só o mês corrente muda sozinho — recarregar um mês fechado seria trabalho
  // à toa contra um número que, por definição, não se mexe mais.
  useEffect(() => {
    if (!ativo) return
    const emCurso = meses.find(m => m.mes === mesAtivo)?.ao_vivo ?? (mesAtivo === dados?.mes && dados?.ao_vivo)
    if (!emCurso) return
    const t = setInterval(() => carregar(mesAtivo), 120000)
    return () => clearInterval(t)
  }, [ativo, mesAtivo, meses, dados, carregar])

  return (
    <div className="ri-page">
      <div className="ri-page-head">
        <div className="ri-page-titulo">
          <h2>🏅 Ranking do Mês</h2>
          <span className="ri-page-sub">
            Contratos pagos em {nomeDoMes(mesAtivo)} · ordenado por valor · empresa inteira
          </span>
        </div>
        {meses.length > 1 && (
          <div className="ri-meses">
            {meses.map(m => (
              <button
                key={m.mes}
                className={`ri-mes${m.mes === mesAtivo ? ' is-on' : ''}`}
                onClick={() => setMesAtivo(m.mes)}
                aria-pressed={m.mes === mesAtivo}
              >
                {nomeDoMes(m.mes)}
                {m.ao_vivo && <span className="ri-mes-tag">em curso</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {erro
        ? <div className="ri-estado">Não foi possível carregar: {erro}</div>
        : (
          <>
            <RankingResumo dados={carregando ? null : dados} unidade="contratos pagos" />
            <RankingLista
              dados={carregando ? null : dados}
              variante="mensal"
              vazio="Nenhum contrato pago neste mês"
            />
          </>
        )
      }
    </div>
  )
}
