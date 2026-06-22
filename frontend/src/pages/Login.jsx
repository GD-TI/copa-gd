import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, UserPlus, Search, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import api from '../api/client'

// ---- Busca de usuário NewCorban (sem autenticação) ----
function CorbanLookup({ onSelect, onClear, selected }) {
  const [query, setQuery] = useState(selected?.username || '')
  const [status, setStatus] = useState(selected ? 'found' : null)
  const [result, setResult] = useState(selected || null)

  const handleSearch = async () => {
    if (!query.trim()) return
    setStatus('loading')
    setResult(null)
    onClear()

    try {
      // Endpoint público de lookup (sem token de app, apenas do sistema)
      const { data } = await api.get(`/auth/lookup-corban?username=${encodeURIComponent(query.trim())}`)
      setResult(data)
      setStatus('found')
      onSelect(data)
    } catch (err) {
      setStatus(err.response?.status === 404 ? 'not_found' : 'error')
      onClear()
    }
  }

  const handleClear = () => {
    setQuery('')
    setStatus(null)
    setResult(null)
    onClear()
  }

  return (
    <div className="space-y-2">
      <label className="label">
        Username NewCorban <span className="text-red-400">*</span>
      </label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            if (status === 'found') { setStatus(null); setResult(null); onClear() }
          }}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="input-field flex-1"
          placeholder="Ex: forca3"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!query.trim() || status === 'loading'}
          className="btn-ghost px-3 flex-shrink-0"
          title="Buscar"
        >
          {status === 'loading'
            ? <Loader size={16} className="animate-spin" />
            : <Search size={16} />
          }
        </button>
      </div>

      {status === 'found' && result && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-copa-green/10 border border-copa-green/30 animate-fade-in-up">
          {result.avatar_url
            ? <img src={result.avatar_url} alt={result.name} className="w-9 h-9 rounded-full object-cover border border-copa-green/40 flex-shrink-0" />
            : <div className="w-9 h-9 rounded-full bg-copa-blue flex items-center justify-center text-copa-yellow font-bold flex-shrink-0">{result.name?.charAt(0)}</div>
          }
          <div className="flex-1 min-w-0">
            <p className="text-copa-green font-semibold text-sm leading-tight">{result.name}</p>
            <p className="text-white/40 text-xs truncate">{result.team_name}</p>
          </div>
          <CheckCircle size={16} className="text-copa-green flex-shrink-0" />
          <button type="button" onClick={handleClear} className="text-white/30 hover:text-white/60 ml-1 flex-shrink-0" title="Remover">✕</button>
        </div>
      )}

      {status === 'not_found' && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-xs">
            Usuário <strong>"{query}"</strong> não encontrado no NewCorban. Verifique o username.
          </p>
        </div>
      )}

      {status === 'error' && (
        <p className="text-orange-400 text-xs flex items-center gap-1">
          <AlertCircle size={12} /> Não foi possível consultar o NewCorban. Tente novamente.
        </p>
      )}
    </div>
  )
}

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const { login } = useAuth()
  const navigate = useNavigate()

  // ---- Estado do login ----
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [showLoginPass, setShowLoginPass] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)

  // ---- Estado do cadastro ----
  const [regForm, setRegForm] = useState({ username: '', password: '', confirmPassword: '' })
  const [showRegPass, setShowRegPass] = useState(false)
  const [corbanUser, setCorbanUser] = useState(null)
  const [regLoading, setRegLoading] = useState(false)

  // ---- Login ----
  const handleLogin = async (e) => {
    e.preventDefault()
    setLoginLoading(true)
    try {
      const user = await login(loginForm.username.trim(), loginForm.password)
      toast.success(`Bem-vindo, ${user.display_name || user.username}! 🏆`)
      navigate(user.role === 'admin' ? '/admin' : '/', { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Usuário ou senha inválidos')
    } finally {
      setLoginLoading(false)
    }
  }

  // ---- Cadastro ----
  const handleRegister = async (e) => {
    e.preventDefault()

    if (!corbanUser) {
      toast.error('Busque e confirme seu usuário NewCorban antes de continuar')
      return
    }
    if (regForm.password !== regForm.confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    if (regForm.password.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres')
      return
    }

    setRegLoading(true)
    try {
      const { data } = await api.post('/auth/register', {
        username: regForm.username.trim(),
        password: regForm.password,
        newcorban_username: corbanUser.username,
      })

      localStorage.setItem('copa_token', data.token)
      localStorage.setItem('copa_user', JSON.stringify(data.user))

      toast.success(`Conta criada! Bem-vindo, ${data.user.display_name}! ⚽`)
      // Recarregar para o AuthContext pegar o novo token
      window.location.href = '/'
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao criar conta')
    } finally {
      setRegLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-copa-navy flex items-center justify-center p-4 relative overflow-hidden">
      {/* Fundo decorativo */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-copa-green/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-copa-yellow/10 rounded-full blur-3xl" />
        <div className="absolute top-10 right-10 text-8xl opacity-10 select-none">🏆</div>
        <div className="absolute bottom-10 left-10 text-8xl opacity-10 select-none">⚽</div>
      </div>

      <div className="w-full max-w-sm relative">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-6xl mb-3 select-none">🏆</div>
          <h1 className="text-3xl font-black">
            <span className="text-copa-yellow">COPA</span>
            <span className="text-copa-green ml-2">GD</span>
          </h1>
          <p className="text-copa-yellow font-bold text-lg mt-0.5">2026</p>
          <p className="text-white/40 text-sm mt-1">Sistema de Gamificação de Vendas</p>
        </div>

        {/* Toggle */}
        <div className="flex bg-copa-card rounded-xl p-1 mb-4 border border-white/10">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === 'login'
                ? 'bg-copa-green text-white shadow'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <LogIn size={14} className="inline mr-1.5 -mt-0.5" />
            Entrar
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === 'register'
                ? 'bg-copa-blue text-white shadow'
                : 'text-white/50 hover:text-white'
            }`}
          >
            <UserPlus size={14} className="inline mr-1.5 -mt-0.5" />
            Cadastrar
          </button>
        </div>

        {/* ---- Formulário de Login ---- */}
        {mode === 'login' && (
          <div className="card border border-white/15 animate-fade-in-up">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Usuário</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                  className="input-field"
                  placeholder="seu.usuario"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Senha</label>
                <div className="relative">
                  <input
                    type={showLoginPass ? 'text' : 'password'}
                    value={loginForm.password}
                    onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                    className="input-field pr-10"
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                  >
                    {showLoginPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading || !loginForm.username.trim() || !loginForm.password}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loginLoading ? <span className="animate-spin">⚽</span> : <LogIn size={16} />}
                {loginLoading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </div>
        )}

        {/* ---- Formulário de Cadastro ---- */}
        {mode === 'register' && (
          <div className="card border border-white/15 animate-fade-in-up">
            <form onSubmit={handleRegister} className="space-y-4">

              {/* Username NewCorban — primeiro, para orientar o usuário */}
              <CorbanLookup
                onSelect={setCorbanUser}
                onClear={() => setCorbanUser(null)}
                selected={corbanUser}
              />

              <div className="border-t border-white/10 pt-4 space-y-3">
                <div>
                  <label className="label">
                    Usuário no app <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={regForm.username}
                    onChange={e => setRegForm(f => ({ ...f, username: e.target.value }))}
                    className="input-field"
                    placeholder="escolha.seu.usuario"
                    autoComplete="username"
                  />
                  <p className="text-white/30 text-xs mt-1">Usado para entrar no sistema</p>
                </div>

                <div>
                  <label className="label">
                    Senha <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPass ? 'text' : 'password'}
                      value={regForm.password}
                      onChange={e => setRegForm(f => ({ ...f, password: e.target.value }))}
                      className="input-field pr-10"
                      placeholder="mínimo 6 caracteres"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showRegPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="label">
                    Confirmar senha <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    value={regForm.confirmPassword}
                    onChange={e => setRegForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    className={`input-field ${
                      regForm.confirmPassword && regForm.confirmPassword !== regForm.password
                        ? 'border-red-500/50 focus:ring-red-500'
                        : ''
                    }`}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  {regForm.confirmPassword && regForm.confirmPassword !== regForm.password && (
                    <p className="text-red-400 text-xs mt-1">As senhas não conferem</p>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={
                  regLoading ||
                  !corbanUser ||
                  !regForm.username.trim() ||
                  !regForm.password ||
                  regForm.password !== regForm.confirmPassword
                }
                className="btn-secondary w-full flex items-center justify-center gap-2"
              >
                {regLoading ? <span className="animate-spin">⚽</span> : <UserPlus size={16} />}
                {regLoading ? 'Criando conta...' : 'Criar conta'}
              </button>

              {!corbanUser && (
                <p className="text-white/30 text-xs text-center">
                  Busque seu username NewCorban acima para continuar
                </p>
              )}
            </form>
          </div>
        )}

        <p className="text-center text-white/20 text-xs mt-5">
          Copa GD 2026 · Grupo Digital SF
        </p>
      </div>
    </div>
  )
}
