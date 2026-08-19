import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { showToast } from '../utils/toast'

/**
 * Cadastro dos donos de franquia (só a matriz enxerga esta seção).
 *
 * O acesso é criado aqui, e não pelo login do NewCorban: o vínculo dono ↔
 * franquia é decisão da matriz. Derivar do cadastro do NewCorban faria consultor
 * com `franquia_id` nulo virar dono da matriz por acidente.
 *
 * O catálogo de franquias vem de `GET /api/franquias`, que lê o cadastro do
 * NewCorban — não existe tabela local, então franquia nova aparece sozinha. As
 * encerradas ficam de fora (`FRANQUIAS_INATIVAS` no backend).
 */
export default function FranqueadosConfig() {
  const [franquias, setFranquias] = useState([])
  const [erroCatalogo, setErroCatalogo] = useState('')
  const [donos, setDonos] = useState([])
  const [loading, setLoading] = useState(true)

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [selecionadas, setSelecionadas] = useState([])
  const [editandoId, setEditandoId] = useState(null)
  const [salvando, setSalvando] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/admin/franqueados')
      .then(r => setDonos(r.data || []))
      .catch(() => setDonos([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Franquia fora de operação não vem no catálogo, mas dono já vinculado a uma
  // delas precisa continuar aparecendo com nome e caixa marcável — senão o
  // vínculo fica invisível e sem como desfazer. Daí o `?incluir=`.
  const vinculadas = donos.flatMap(d => d.franquia_ids || []).join(',')

  useEffect(() => {
    api.get('/franquias', { params: vinculadas ? { incluir: vinculadas } : {} })
      .then(r => { setFranquias(r.data?.franquias || []); setErroCatalogo('') })
      .catch(e => setErroCatalogo(e.response?.data?.error || 'Não foi possível ler as franquias do NewCorban'))
  }, [vinculadas])

  const nomeDaFranquia = id => franquias.find(f => f.id === id)?.nome || id

  const alternar = id => setSelecionadas(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  )

  const limpar = () => {
    setUsername(''); setDisplayName(''); setPassword('')
    setSelecionadas([]); setEditandoId(null)
  }

  const editar = d => {
    setEditandoId(d.id)
    setUsername(d.username)
    setDisplayName(d.display_name || '')
    setPassword('')
    setSelecionadas(Array.isArray(d.franquia_ids) ? [...d.franquia_ids] : [])
  }

  const salvar = async () => {
    if (!username.trim()) return showToast('Informe o usuário', false)
    if (!editandoId && !password) return showToast('Informe a senha', false)
    if (selecionadas.length === 0) return showToast('Selecione ao menos uma franquia', false)

    setSalvando(true)
    try {
      if (editandoId) {
        const body = { display_name: displayName, franquia_ids: selecionadas, active: true }
        if (password) body.password = password
        if (username !== donos.find(d => d.id === editandoId)?.username) body.username = username
        await api.put(`/admin/franqueados/${editandoId}`, body)
        showToast('Dono de franquia atualizado!')
      } else {
        await api.post('/admin/franqueados', {
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          password,
          franquia_ids: selecionadas,
        })
        showToast('Dono de franquia criado!')
      }
      limpar()
      load()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao salvar', false)
    } finally {
      setSalvando(false)
    }
  }

  const desativar = async d => {
    if (!window.confirm(
      `Desativar o acesso de "${d.display_name || d.username}"?\n\n` +
      'As campanhas que ele criou continuam valendo — só o login deixa de funcionar.'
    )) return
    try {
      await api.put(`/admin/franqueados/${d.id}`, { active: false })
      showToast('Acesso desativado')
      load()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro', false)
    }
  }

  const ativos = donos.filter(d => d.active !== false)

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="card" style={{ marginBottom: 12, padding: '16px 18px' }}>
        <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          {editandoId ? 'Editar dono de franquia' : 'Novo dono de franquia'}
        </div>

        <div className="cfg-2col" style={{ marginBottom: 12 }}>
          <div className="field-group">
            <label className="field-label">Usuário (login)</label>
            <input className="field-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="ex: dono.tatuape" />
          </div>
          <div className="field-group">
            <label className="field-label">Nome exibido</label>
            <input className="field-input" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Nome no painel" />
          </div>
        </div>

        <div className="field-group" style={{ marginBottom: 12 }}>
          <label className="field-label">{editandoId ? 'Nova senha (opcional)' : 'Senha'}</label>
          <input
            type="password" className="field-input" value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={editandoId ? 'Deixe em branco para manter' : 'Mínimo 6 caracteres'}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div className="field-label" style={{ marginBottom: 8 }}>Franquias que ele administra</div>

          {erroCatalogo ? (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>{erroCatalogo}</div>
          ) : franquias.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Carregando franquias…</div>
          ) : (
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
                  <input type="checkbox" checked={selecionadas.includes(f.id)} onChange={() => alternar(f.id)} />
                  {f.nome}
                  <span style={{ color: 'var(--txt3)' }}>({f.consultores})</span>
                </label>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 6 }}>
            Ele cria campanhas só para as franquias marcadas. Campanha para todas continua sendo só da matriz.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-gold" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : editandoId ? '💾 Atualizar' : '➕ Criar acesso'}
          </button>
          {editandoId && <button type="button" className="btn btn-ghost" onClick={limpar}>Cancelar</button>}
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 20, color: 'var(--txt3)', fontSize: 13 }}>Carregando…</div>
      ) : ativos.length === 0 ? (
        <div className="card" style={{ padding: 20, color: 'var(--txt3)', fontSize: 13 }}>
          Nenhum dono de franquia cadastrado
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="sync-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Franquias</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {ativos.map(d => (
                <tr key={d.id}>
                  <td>
                    <div className="s-name">{d.display_name || d.username}</div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>@{d.username}</div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--txt2)' }}>
                    {(d.franquia_ids || []).map(nomeDaFranquia).join(', ') || '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, marginRight: 6 }} onClick={() => editar(d)}>Editar</button>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, color: 'var(--red)' }} onClick={() => desativar(d)}>Desativar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
