import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

function showToast(msg, ok = true) {
  const el = document.createElement('div')
  el.textContent = msg
  Object.assign(el.style, {
    position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
    background: ok ? 'var(--txt)' : '#ef4444', color: ok ? 'var(--surf)' : '#fff',
    padding: '10px 20px', borderRadius: 10, fontSize: 13,
    fontWeight: 600, boxShadow: 'var(--sh-lg)',
    opacity: 1, transition: 'opacity .3s',
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 350) }, 2500)
}

function ini(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

function photoSrc(group) {
  if (!group?.photo_url) return null
  const v = group.updated_at ? new Date(group.updated_at).getTime() : Date.now()
  return group.photo_url.startsWith('/api/') ? `${group.photo_url}?v=${v}` : group.photo_url
}

function TeamAvatar({ group, size = 40, onClick, disabled, title }) {
  const [broken, setBroken] = useState(false)
  const src = photoSrc(group)
  const showImg = src && !broken

  return (
    <button
      type="button"
      className="s-av"
      style={{
        width: size, height: size, flexShrink: 0, cursor: onClick ? 'pointer' : 'default',
        padding: 0, border: 'none', background: 'none',
      }}
      title={title}
      disabled={disabled}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(e) } : undefined}
    >
      {showImg
        ? <img src={src} alt="" onError={() => setBroken(true)} />
        : ini(group.name)}
    </button>
  )
}

// ── Cadastrar jogador pelo login NewCorban ───────────────────────────────────
function AddPlayerForm({ groups, onAdded }) {
  const [query, setQuery] = useState('')
  const [corban, setCorban] = useState(null)
  const [searching, setSearching] = useState(false)
  const [groupId, setGroupId] = useState('')
  const [saving, setSaving] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setCorban(null)
    try {
      const r = await api.get(`/auth/lookup-corban?username=${encodeURIComponent(query.trim())}`)
      setCorban(r.data)
    } catch (e) {
      showToast(e.response?.data?.error || 'Usuário não encontrado no NewCorban', false)
    } finally {
      setSearching(false)
    }
  }

  const handleAdd = async () => {
    if (!corban) return
    setSaving(true)
    try {
      await api.post('/admin/users', {
        corban_username: corban.username,
        role: 'player',
        group_id: groupId ? parseInt(groupId) : undefined,
      })
      showToast(`Jogador ${corban.name} cadastrado!`)
      setQuery('')
      setCorban(null)
      setGroupId('')
      onAdded()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao cadastrar', false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ font: '700 11px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 14 }}>
        Cadastrar Jogador (login NewCorban)
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="field-input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Ex: alessandro.ti"
          value={query}
          onChange={e => { setQuery(e.target.value); setCorban(null) }}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button className="btn btn-ghost" onClick={search} disabled={searching || !query.trim()}>
          {searching ? 'Buscando…' : '🔍 Buscar'}
        </button>
      </div>

      {corban && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--surf2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ font: '600 13px/1 var(--font)', color: 'var(--txt)' }}>{corban.name}</div>
            <div style={{ font: '400 11px/1 var(--font)', color: 'var(--txt3)', marginTop: 3 }}>@{corban.username}</div>
          </div>
          <select className="field-input" style={{ width: 160 }} value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">Sem equipe</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name} ({g.member_count}/5)</option>
            ))}
          </select>
          <button className="btn btn-gold" onClick={handleAdd} disabled={saving}>
            {saving ? 'Salvando…' : '✅ Cadastrar'}
          </button>
        </div>
      )}
      <p style={{ font: '400 11px/1.4 var(--font)', color: 'var(--txt3)', margin: 0 }}>
        O consultor entrará com o login NewCorban e definirá a senha no primeiro acesso.
      </p>
    </div>
  )
}

// ── Gestão de equipes ───────────────────────────────────────────────────────
export default function ShellAdminTeams({ groups, onRefresh }) {
  const [expanded, setExpanded] = useState(null)
  const [members, setMembers] = useState({})
  const [loadingMembers, setLoadingMembers] = useState(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamPhoto, setNewTeamPhoto] = useState(null)
  const [newTeamPhotoPreview, setNewTeamPhotoPreview] = useState(null)
  const [creating, setCreating] = useState(false)
  const [allPlayers, setAllPlayers] = useState([])
  const [addUserId, setAddUserId] = useState({})
  const [busy, setBusy] = useState(null)

  const loadPlayers = useCallback(() => {
    api.get('/admin/users').then(r => {
      setAllPlayers((r.data || []).filter(u => u.role === 'player' && u.active))
    }).catch(() => {})
  }, [])

  useEffect(() => { loadPlayers() }, [loadPlayers])

  const loadMembers = async (groupId) => {
    setLoadingMembers(groupId)
    try {
      const r = await api.get(`/admin/groups/${groupId}/members`)
      setMembers(prev => ({ ...prev, [groupId]: r.data || [] }))
    } catch {
      setMembers(prev => ({ ...prev, [groupId]: [] }))
    } finally {
      setLoadingMembers(null)
    }
  }

  const toggleExpand = (groupId) => {
    if (expanded === groupId) {
      setExpanded(null)
    } else {
      setExpanded(groupId)
      if (!members[groupId]) loadMembers(groupId)
    }
  }

  const handleNewTeamPhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Selecione uma imagem (JPG, PNG, etc.)', false)
      return
    }
    setNewTeamPhoto(file)
    setNewTeamPhotoPreview(URL.createObjectURL(file))
  }

  const handleCreate = async () => {
    if (!newTeamName.trim()) return
    setCreating(true)
    try {
      const formData = new FormData()
      formData.append('name', newTeamName.trim())
      if (newTeamPhoto) formData.append('photo', newTeamPhoto)
      await api.post('/admin/groups', formData)
      showToast('Equipe criada!')
      setNewTeamName('')
      setNewTeamPhoto(null)
      setNewTeamPhotoPreview(null)
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao criar equipe', false)
    } finally {
      setCreating(false)
    }
  }

  const handlePhotoChange = async (groupId, file) => {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Selecione uma imagem (JPG, PNG, etc.)', false)
      return
    }
    setBusy(`photo-${groupId}`)
    try {
      const formData = new FormData()
      formData.append('photo', file)
      await api.put(`/admin/groups/${groupId}/photo`, formData)
      showToast('Foto atualizada!')
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao enviar foto', false)
    } finally {
      setBusy(null)
    }
  }

  const handlePhotoClear = async (groupId) => {
    if (!window.confirm('Remover a foto desta equipe? Você poderá enviar uma nova em seguida.')) return
    setBusy(`photo-clear-${groupId}`)
    try {
      await api.delete(`/admin/groups/${groupId}/photo`)
      showToast('Foto removida')
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro ao remover foto', false)
    } finally {
      setBusy(null)
    }
  }

  const pickPhoto = (groupId) => {
    document.getElementById(`team-photo-${groupId}`)?.click()
  }

  const handleDelete = async (g) => {
    if (!window.confirm(`Desativar a equipe "${g.name}"?`)) return
    setBusy(`del-${g.id}`)
    try {
      await api.delete(`/admin/groups/${g.id}`)
      showToast('Equipe desativada')
      if (expanded === g.id) setExpanded(null)
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro', false)
    } finally {
      setBusy(null)
    }
  }

  const handleAddMember = async (groupId) => {
    const userId = addUserId[groupId]
    if (!userId) return
    setBusy(`add-${groupId}`)
    try {
      await api.post(`/admin/groups/${groupId}/members`, { user_id: parseInt(userId) })
      showToast('Jogador adicionado!')
      setAddUserId(prev => ({ ...prev, [groupId]: '' }))
      loadMembers(groupId)
      loadPlayers()
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro', false)
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveMember = async (groupId, userId) => {
    if (!window.confirm('Remover este jogador da equipe?')) return
    setBusy(`rm-${userId}`)
    try {
      await api.delete(`/admin/groups/${groupId}/members/${userId}`)
      showToast('Jogador removido')
      loadMembers(groupId)
      loadPlayers()
      onRefresh()
    } catch (e) {
      showToast(e.response?.data?.error || 'Erro', false)
    } finally {
      setBusy(null)
    }
  }

  const unassignedPlayers = (groupId) => {
    const inGroup = new Set((members[groupId] || []).map(m => m.id))
    return allPlayers.filter(p => !inGroup.has(p.id))
  }

  return (
    <div>
      <AddPlayerForm groups={groups} onAdded={() => { loadPlayers(); onRefresh() }} />

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="s-av"
            style={{ width: 52, height: 52, flexShrink: 0, cursor: 'pointer', border: '2px dashed var(--border)' }}
            title="Foto da equipe (opcional)"
            onClick={() => document.getElementById('new-team-photo')?.click()}
          >
            {newTeamPhotoPreview
              ? <img src={newTeamPhotoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
              : <span style={{ fontSize: 18, color: 'var(--txt3)' }}>📷</span>}
          </button>
          <input
            id="new-team-photo"
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleNewTeamPhoto}
          />
          <div className="field-group" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <label className="field-label">Nova Equipe</label>
            <input
              className="field-input"
              placeholder="Nome da equipe"
              maxLength={100}
              value={newTeamName}
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <button className="btn btn-gold" onClick={handleCreate} disabled={creating || !newTeamName.trim()}>
            {creating ? 'Criando…' : '➕ Criar Equipe'}
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)', fontSize: 13 }}>
          Nenhuma equipe cadastrada
        </div>
      ) : groups.map(g => (
        <div key={g.id} className="card" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
            onClick={() => toggleExpand(g.id)}
          >
            <TeamAvatar
              group={g}
              size={40}
              title="Alterar foto da equipe"
              disabled={busy === `photo-${g.id}`}
              onClick={() => pickPhoto(g.id)}
            />
            <input
              id={`team-photo-${g.id}`}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handlePhotoChange(g.id, file)
              }}
            />
            <div style={{ flex: 1 }}>
              <div className="s-name">{g.name}</div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                {g.member_count}/5 membros
                {g.daily_goal_value > 0 && ` · Meta dia: R$ ${Number(g.daily_goal_value).toLocaleString('pt-BR')}`}
                {g.weekly_goal_value > 0 && ` · Semana: R$ ${Number(g.weekly_goal_value).toLocaleString('pt-BR')}`}
              </div>
            </div>
            <span style={{ color: 'var(--txt3)', fontSize: 12 }}>{expanded === g.id ? '▲' : '▼'}</span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '5px 10px', color: 'var(--red)' }}
              disabled={busy === `del-${g.id}`}
              onClick={e => { e.stopPropagation(); handleDelete(g) }}
            >
              🗑️
            </button>
          </div>

          {expanded === g.id && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11 }}
                  disabled={busy === `photo-${g.id}`}
                  onClick={() => pickPhoto(g.id)}
                >
                  {busy === `photo-${g.id}` ? 'Enviando…' : '📷 Enviar nova foto'}
                </button>
                {g.photo_url && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, color: 'var(--txt3)' }}
                    disabled={busy === `photo-clear-${g.id}`}
                    onClick={() => handlePhotoClear(g.id)}
                  >
                    Remover foto antiga
                  </button>
                )}
              </div>

              {loadingMembers === g.id && (
                <div style={{ color: 'var(--txt3)', fontSize: 12, padding: '8px 0' }}>Carregando membros…</div>
              )}

              {(members[g.id] || []).map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ font: '600 12px/1 var(--font)', color: 'var(--txt)' }}>{m.display_name}</div>
                    <div style={{ font: '400 10px/1 var(--font)', color: 'var(--txt3)', marginTop: 2 }}>
                      @{m.corban_username || m.username}
                      {m.needs_password_setup && <span style={{ color: 'var(--gold)', marginLeft: 6 }}>· aguardando 1º acesso</span>}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    disabled={busy === `rm-${m.id}`}
                    onClick={() => handleRemoveMember(g.id, m.id)}
                  >
                    Remover
                  </button>
                </div>
              ))}

              {(members[g.id] || []).length < 5 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <select
                    className="field-input"
                    style={{ flex: 1, minWidth: 180 }}
                    value={addUserId[g.id] || ''}
                    onChange={e => setAddUserId(prev => ({ ...prev, [g.id]: e.target.value }))}
                  >
                    <option value="">Adicionar jogador…</option>
                    {unassignedPlayers(g.id).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.display_name} (@{p.corban_username || p.username})
                        {p.group_id && p.group_id !== g.id ? ' — mover de outra equipe' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-gold"
                    style={{ fontSize: 11 }}
                    disabled={!addUserId[g.id] || busy === `add-${g.id}`}
                    onClick={() => handleAddMember(g.id)}
                  >
                    Adicionar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
