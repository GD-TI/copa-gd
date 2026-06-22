import { useState, useEffect } from 'react'
import { Plus, Edit, UserX, Move, Search, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import api from '../../api/client'

// ---- Componente de busca por username NewCorban ----
function CorbanUserSearch({ onSelect }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(null) // null | 'loading' | 'found' | 'not_found' | 'error'
  const [result, setResult] = useState(null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setStatus('loading')
    setResult(null)
    try {
      const { data } = await api.get(`/admin/newcorban-users/lookup?username=${encodeURIComponent(query.trim())}`)
      setResult(data)
      setStatus('found')
    } catch (err) {
      setStatus(err.response?.status === 404 ? 'not_found' : 'error')
    }
  }

  const handleSelect = () => {
    if (result) onSelect(result)
  }

  return (
    <div className="space-y-2">
      <label className="label">Username NewCorban</label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setStatus(null); setResult(null) }}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="input-field flex-1"
          placeholder="Ex: forca3"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!query.trim() || status === 'loading'}
          className="btn-ghost px-3 flex-shrink-0"
        >
          {status === 'loading' ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
        </button>
      </div>

      {status === 'found' && result && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-copa-green/10 border border-copa-green/30">
          {result.avatar_url && (
            <img src={result.avatar_url} alt={result.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-copa-green font-semibold text-sm">{result.name}</p>
            <p className="text-white/50 text-xs">{result.team_name} · ID: {result.id}</p>
          </div>
          <CheckCircle size={16} className="text-copa-green flex-shrink-0" />
          <button type="button" onClick={handleSelect} className="btn-primary py-1 px-3 text-xs flex-shrink-0">
            Usar
          </button>
        </div>
      )}

      {status === 'not_found' && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle size={14} className="text-red-400" />
          <p className="text-red-400 text-xs">Usuário não encontrado no NewCorban</p>
        </div>
      )}

      {status === 'error' && (
        <p className="text-red-400 text-xs">Erro ao consultar API NewCorban. Verifique as credenciais no .env</p>
      )}
    </div>
  )
}

// ---- Modal de criar/editar usuário ----
function UserModal({ user, groups, onClose, onSave }) {
  const [form, setForm] = useState({
    username: user?.username || '',
    password: '',
    display_name: user?.display_name || '',
    role: user?.role || 'player',
    corban_id: user?.corban_id || '',
    corban_username: user?.corban_username || '',
    corban_name: user?.corban_name || '',
    corban_avatar_url: user?.corban_avatar_url || '',
  })
  const [saving, setSaving] = useState(false)

  const handleCorbanSelect = (corbanUser) => {
    setForm(f => ({
      ...f,
      corban_id: corbanUser.id,
      corban_username: corbanUser.username,
      corban_name: corbanUser.name,
      corban_avatar_url: corbanUser.avatar_url || '',
    }))
    toast.success(`Vinculado: ${corbanUser.name}`)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (user) {
        await api.put(`/admin/users/${user.id}`, form)
      } else {
        await api.post('/admin/users', form)
      }
      toast.success(user ? 'Usuário atualizado!' : 'Usuário criado!')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-lg border-white/20 my-4">
        <div className="flex justify-between items-center mb-5">
          <h3 className="font-bold text-white text-lg">{user ? 'Editar Usuário' : 'Novo Usuário'}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Dados do app */}
          <div className="p-3 bg-copa-navy rounded-lg space-y-3">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-wide">Acesso ao App</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Login *</label>
                <input
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="input-field"
                  placeholder="login.do.usuario"
                  required
                />
              </div>
              <div>
                <label className="label">{user ? 'Nova Senha' : 'Senha *'}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input-field"
                  placeholder={user ? '(manter atual)' : '••••••••'}
                  required={!user}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nome de Exibição</label>
                <input
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  className="input-field"
                  placeholder="Nome Completo"
                />
              </div>
              <div>
                <label className="label">Papel</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input-field">
                  <option value="player">Jogador</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
          </div>

          {/* Vinculação NewCorban (só para jogadores) */}
          {form.role === 'player' && (
            <div className="p-3 bg-copa-navy rounded-lg space-y-3">
              <p className="text-white/50 text-xs font-semibold uppercase tracking-wide">Vinculação NewCorban</p>

              <CorbanUserSearch onSelect={handleCorbanSelect} />

              {/* Campos preenchidos automaticamente (editáveis) */}
              {form.corban_id && (
                <div className="p-2 bg-copa-green/10 border border-copa-green/20 rounded-lg flex items-center gap-3">
                  {form.corban_avatar_url && (
                    <img src={form.corban_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-copa-green font-semibold text-sm">{form.corban_name}</p>
                    <p className="text-white/40 text-xs">@{form.corban_username} · ID: {form.corban_id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, corban_id: '', corban_username: '', corban_name: '', corban_avatar_url: '' }))}
                    className="text-white/30 hover:text-red-400 text-xs"
                  >
                    ✕
                  </button>
                </div>
              )}

              <p className="text-white/30 text-xs">
                Digite o username NewCorban do vendedor e clique em buscar para vincular automaticamente.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? '⚽ Salvando...' : 'Salvar'}
            </button>
            <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Modal de mover grupo ----
function MoveGroupModal({ user, groups, onClose, onSave }) {
  const [groupId, setGroupId] = useState(user.group_id ? String(user.group_id) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.post(`/admin/users/${user.id}/move-group`, { group_id: groupId || null })
      toast.success('Jogador movido!')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao mover')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-sm border-white/20">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-white">Mover Jogador</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl">✕</button>
        </div>
        <div className="flex items-center gap-3 p-2 bg-copa-navy rounded-lg mb-4">
          {user.corban_avatar_url && (
            <img src={user.corban_avatar_url} alt={user.display_name} className="w-8 h-8 rounded-full object-cover" />
          )}
          <div>
            <p className="text-white font-medium text-sm">{user.display_name}</p>
            {user.group_name && <p className="text-white/40 text-xs">Atualmente: {user.group_name}</p>}
          </div>
        </div>
        <select value={groupId} onChange={e => setGroupId(e.target.value)} className="input-field mb-4">
          <option value="">Remover do grupo</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.name} ({g.member_count}/5)</option>
          ))}
        </select>
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">{saving ? 'Movendo...' : 'Confirmar'}</button>
          <button onClick={onClose} className="btn-ghost flex-1">Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// ---- Página principal ----
export default function ManageUsers() {
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')

  const loadData = async () => {
    try {
      const [usersRes, groupsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/groups'),
      ])
      setUsers(usersRes.data)
      setGroups(groupsRes.data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadData() }, [])

  const handleDeactivate = async (user) => {
    if (!confirm(`Remover "${user.display_name}" da competição?`)) return
    try {
      await api.post(`/admin/users/${user.id}/deactivate`)
      toast.success('Jogador removido da competição')
      loadData()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro')
    }
  }

  const players = users
    .filter(u => u.role === 'player')
    .filter(u => !search || u.display_name?.toLowerCase().includes(search.toLowerCase()) || u.username?.toLowerCase().includes(search.toLowerCase()))

  const admins = users.filter(u => u.role === 'admin')

  return (
    <Layout>
      {modal?.type === 'user' && (
        <UserModal user={modal.data} groups={groups} onClose={() => setModal(null)} onSave={() => { setModal(null); loadData() }} />
      )}
      {modal?.type === 'move' && (
        <MoveGroupModal user={modal.data} groups={groups} onClose={() => setModal(null)} onSave={() => { setModal(null); loadData() }} />
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-black text-white">Jogadores</h1>
        <button onClick={() => setModal({ type: 'user', data: null })} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Novo Usuário
        </button>
      </div>

      {/* Busca */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-field pl-9"
          placeholder="Buscar jogador..."
        />
      </div>

      {/* Tabela de jogadores */}
      <div className="card mb-6 overflow-x-auto">
        <h2 className="font-bold text-white mb-4">⚽ Jogadores ({players.length})</h2>
        {loading ? (
          <p className="text-white/40 text-sm">Carregando...</p>
        ) : players.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">{search ? 'Nenhum resultado' : 'Nenhum jogador cadastrado'}</p>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-white/40 border-b border-white/10 text-xs">
                <th className="text-left py-2 pr-4 font-medium">Nome</th>
                <th className="text-left py-2 pr-4 font-medium">Login App</th>
                <th className="text-left py-2 pr-4 font-medium">NewCorban</th>
                <th className="text-left py-2 pr-4 font-medium">Grupo</th>
                <th className="text-left py-2 pr-4 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {players.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      {u.corban_avatar_url ? (
                        <img src={u.corban_avatar_url} alt={u.display_name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-copa-blue flex items-center justify-center text-xs font-bold text-copa-yellow flex-shrink-0">
                          {(u.display_name || '?').charAt(0)}
                        </div>
                      )}
                      <span className="text-white font-medium truncate max-w-[140px]">{u.display_name || u.username}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-white/50 font-mono text-xs">{u.username}</td>
                  <td className="py-2.5 pr-4">
                    {u.corban_id ? (
                      <div>
                        <span className="badge-green text-xs">@{u.corban_username || u.corban_id}</span>
                        {u.corban_name && <span className="text-white/30 text-xs ml-1 hidden xl:inline">({u.corban_name})</span>}
                      </div>
                    ) : (
                      <span className="text-orange-400/70 text-xs flex items-center gap-1">
                        <AlertCircle size={11} /> não vinculado
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-white/60 text-xs">{u.group_name || <span className="text-white/25">—</span>}</td>
                  <td className="py-2.5 pr-4">
                    {u.active ? <span className="badge-green">Ativo</span> : <span className="badge-red">Inativo</span>}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModal({ type: 'user', data: u })} className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors" title="Editar">
                        <Edit size={13} />
                      </button>
                      <button onClick={() => setModal({ type: 'move', data: u })} className="p-1.5 hover:bg-blue-500/20 rounded text-blue-400 hover:text-blue-300 transition-colors" title="Mover grupo">
                        <Move size={13} />
                      </button>
                      {u.active && (
                        <button onClick={() => handleDeactivate(u)} className="p-1.5 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 transition-colors" title="Tirar da competição">
                          <UserX size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Admins */}
      <div className="card">
        <h2 className="font-bold text-white mb-4">⚙️ Administradores ({admins.length})</h2>
        <div className="space-y-2">
          {admins.map(u => (
            <div key={u.id} className="flex items-center justify-between p-2.5 rounded-lg bg-copa-navy">
              <div>
                <span className="text-white font-medium">{u.display_name}</span>
                <span className="text-white/40 ml-2 text-sm font-mono">({u.username})</span>
              </div>
              <button onClick={() => setModal({ type: 'user', data: u })} className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white transition-colors">
                <Edit size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}
