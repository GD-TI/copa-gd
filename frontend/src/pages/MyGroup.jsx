import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, Plus, LogIn, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

export default function MyGroup() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState(null) // 'create' | 'join' | null
  const [form, setForm] = useState({ name: '' })
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // Se já tem grupo, redirecionar para página do grupo
    if (user?.group) {
      navigate(`/groups/${user.group.id}`, { replace: true })
      return
    }
    api.get('/groups')
      .then(res => setGroups(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user, navigate])

  const handlePhotoChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      setPhoto(file)
      setPhotoPreview(URL.createObjectURL(file))
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('name', form.name.trim())
      if (photo) formData.append('photo', photo)

      await api.post('/groups', formData)
      toast.success('Grupo criado! 🏆')
      await refreshUser()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao criar grupo')
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async (groupId) => {
    try {
      await api.post(`/groups/${groupId}/join`)
      toast.success('Você entrou no grupo! ⚽')
      await refreshUser()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao entrar no grupo')
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="text-4xl animate-bounce">⚽</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚽</div>
          <h1 className="text-2xl font-black text-white">Você ainda não tem grupo!</h1>
          <p className="text-white/50 mt-1">Crie um novo grupo ou entre em um existente</p>
        </div>

        {!mode && (
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => setMode('create')} className="card hover:border-copa-green/40 transition-all text-center py-6 cursor-pointer">
              <Plus size={32} className="mx-auto text-copa-green mb-2" />
              <p className="text-white font-bold">Criar Grupo</p>
              <p className="text-white/40 text-xs mt-1">Seja o capitão</p>
            </button>
            <button onClick={() => setMode('join')} className="card hover:border-copa-blue/40 transition-all text-center py-6 cursor-pointer">
              <LogIn size={32} className="mx-auto text-blue-400 mb-2" />
              <p className="text-white font-bold">Entrar em Grupo</p>
              <p className="text-white/40 text-xs mt-1">Junte-se a um time</p>
            </button>
          </div>
        )}

        {mode === 'create' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Criar Novo Grupo</h2>
              <button onClick={() => setMode(null)} className="text-white/40 hover:text-white text-sm">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Nome do Grupo *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="input-field"
                  placeholder="Ex: Os Melhores"
                  maxLength={100}
                />
              </div>

              <div>
                <label className="label">Foto do Grupo</label>
                <div
                  className="border-2 border-dashed border-white/20 rounded-lg p-6 text-center cursor-pointer hover:border-copa-green/40 transition-colors"
                  onClick={() => document.getElementById('photo-input').click()}
                >
                  {photoPreview ? (
                    <img src={photoPreview} alt="Preview" className="w-20 h-20 rounded-full object-cover mx-auto" />
                  ) : (
                    <>
                      <Upload size={24} className="mx-auto text-white/30 mb-2" />
                      <p className="text-white/40 text-sm">Clique para selecionar</p>
                    </>
                  )}
                </div>
                <input id="photo-input" type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </div>

              <button type="submit" disabled={submitting || !form.name.trim()} className="btn-primary w-full">
                {submitting ? '⚽ Criando...' : 'Criar Grupo'}
              </button>
            </form>
          </div>
        )}

        {mode === 'join' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Grupos Disponíveis</h2>
              <button onClick={() => setMode(null)} className="text-white/40 hover:text-white text-sm">✕</button>
            </div>

            {groups.filter(g => parseInt(g.member_count) < 5).length === 0 ? (
              <div className="card text-center py-8">
                <p className="text-white/40">Todos os grupos estão cheios</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.filter(g => parseInt(g.member_count) < 5).map(group => (
                  <div key={group.id} className="card flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-copa-blue flex-shrink-0">
                      {group.photo_url ? (
                        <img src={group.photo_url} alt={group.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xl">⚽</div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-bold">{group.name}</p>
                      <p className="text-white/40 text-xs">
                        <Users size={10} className="inline mr-1" />
                        {group.member_count}/5 membros
                      </p>
                    </div>
                    <button onClick={() => handleJoin(group.id)} className="btn-primary py-2 px-4 text-sm">
                      Entrar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
