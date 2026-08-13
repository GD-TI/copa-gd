import { useState, useEffect } from 'react'
import api from '../api/client'
import { Telao } from '../pages/ShellRanking'

/**
 * Telão dos rankings individuais — mês e digitados do dia, alternando sozinho.
 *
 * O botão de telão morava só no "Ranking Equipe" (página da Copa, removida em
 * 13/08/2026). Sem isto, tirar aquela página levaria junto a TV do escritório,
 * que é o ponto do produto — e ninguém pediu isso.
 *
 * A página passa o dado que já tem na mão (inclusive de um mês/dia passado, se
 * for o que a pessoa está olhando) e continua atualizando por conta própria: as
 * páginas ficam montadas atrás do telão, então o modo `inicial` chega vivo por
 * prop. O outro modo é buscado aqui — período corrente — para a TV não estrear
 * com metade da tela vazia.
 */
export default function TelaoRankings({ inicial = 'mensal', mensal = null, digitados = null, onClose }) {
  const outroModo = inicial === 'mensal' ? 'digitados' : 'mensal'
  const [outro, setOutro] = useState(null)

  useEffect(() => {
    let vivo = true
    const buscar = () => {
      api.get(`/rankings/${outroModo}`)
        .then(r => { if (vivo) setOutro(r.data) })
        .catch(() => {})
    }
    buscar()
    // O modo que não está na página não tem quem o recarregue; na TV ele fica
    // horas no ar e ficaria congelado no número da hora em que abriu.
    const t = setInterval(buscar, 120000)
    return () => { vivo = false; clearInterval(t) }
  }, [outroModo])

  return (
    <Telao
      groups={[]}
      mensal={inicial === 'mensal' ? mensal : outro}
      digitados={inicial === 'digitados' ? digitados : outro}
      modes={[inicial, outroModo]}
      onClose={onClose}
    />
  )
}
