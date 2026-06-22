import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, LogIn, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../contexts/AuthContext'
import api from '../api/client'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [step, setStep] = useState('username') // 'username' | 'login' | 'setup'
  const [displayName, setDisplayName] = useState('')

  const handleCheckUser = async (e) => {
    e?.preventDefault()
    if (!username.trim()) return
    setChecking(true)
    try {
      const { data } = await api.get(`/auth/check-user?username=${encodeURIComponent(username.trim())}`)
      setDisplayName(data.display_name)
      if (data.needs_password_setup) {
        setStep('setup')
        setPassword('')
        setConfirmPassword('')
      } else {
        setStep('login')
        setPassword('')
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Usuário não cadastrado. Solicite ao administrador.')
      setStep('username')
    } finally {
      setChecking(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(username.trim(), password)
      toast.success(`Bem-vindo, ${user.display_name || user.username}! 🏆`)
      navigate('/', { replace: true })
    } catch (err) {
      if (err.response?.status === 403 && err.response?.data?.needs_password_setup) {
        setStep('setup')
        setDisplayName(err.response.data.display_name)
        toast('Primeiro acesso: defina sua senha', { icon: '🔑' })
      } else {
        toast.error(err.response?.data?.error || 'Usuário ou senha inválidos')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSetupPassword = async (e) => {
    e.preventDefault()
    if (password.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres')
      return
    }
    if (password !== confirmPassword) {
      toast.error('As senhas não conferem')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/setup-password', {
        username: username.trim(),
        password,
      })
      localStorage.setItem('copa_token', data.token)
      localStorage.setItem('copa_user', JSON.stringify(data.user))
      toast.success(`Senha definida! Bem-vindo, ${data.user.display_name}! ⚽`)
      window.location.href = '/'
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erro ao definir senha')
    } finally {
      setLoading(false)
    }
  }

  const resetFlow = () => {
    setStep('username')
    setPassword('')
    setConfirmPassword('')
    setDisplayName('')
  }

  return (
    <div className="min-h-screen bg-copa-navy flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-copa-green/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-copa-yellow/10 rounded-full blur-3xl" />
        <div className="absolute top-10 right-10 text-8xl opacity-10 select-none">🏆</div>
        <div className="absolute bottom-10 left-10 text-8xl opacity-10 select-none">⚽</div>
      </div>

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-6">
          <div className="text-6xl mb-3 select-none">🏆</div>
          <h1 className="text-3xl font-black">
            <span className="text-copa-yellow">COPA</span>
            <span className="text-copa-green ml-2">GD</span>
          </h1>
          <p className="text-copa-yellow font-bold text-lg mt-0.5">2026</p>
          <p className="text-white/40 text-sm mt-1">Sistema de Gamificação de Vendas</p>
        </div>

        <div className="card border border-white/15 animate-fade-in-up">
          {step === 'username' && (
            <form onSubmit={handleCheckUser} className="space-y-4">
              <div>
                <label className="label">Login NewCorban</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="Ex: alessandro.ti"
                  autoComplete="username"
                  autoFocus
                />
                <p className="text-white/30 text-xs mt-1">Use o mesmo login do NewCorban</p>
              </div>
              <button
                type="submit"
                disabled={checking || !username.trim()}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {checking ? <Loader size={16} className="animate-spin" /> : <LogIn size={16} />}
                {checking ? 'Verificando…' : 'Continuar'}
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="p-3 rounded-lg bg-copa-green/10 border border-copa-green/20">
                <p className="text-copa-green font-semibold text-sm">{displayName}</p>
                <p className="text-white/40 text-xs">@{username.trim()}</p>
              </div>
              <div>
                <label className="label">Senha</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !password}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? <span className="animate-spin">⚽</span> : <LogIn size={16} />}
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
              <button type="button" onClick={resetFlow} className="text-white/30 text-xs w-full text-center hover:text-white/50">
                ← Trocar usuário
              </button>
            </form>
          )}

          {step === 'setup' && (
            <form onSubmit={handleSetupPassword} className="space-y-4">
              <div className="p-3 rounded-lg bg-copa-blue/20 border border-copa-blue/30">
                <p className="text-copa-yellow font-semibold text-sm">Primeiro acesso</p>
                <p className="text-white font-medium">{displayName}</p>
                <p className="text-white/40 text-xs mt-1">Defina sua senha para acessar o sistema</p>
              </div>
              <div>
                <label className="label">Nova senha</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="mínimo 6 caracteres"
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                  >
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirmar senha</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={`input-field ${confirmPassword && confirmPassword !== password ? 'border-red-500/50' : ''}`}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !password || password !== confirmPassword}
                className="btn-secondary w-full"
              >
                {loading ? 'Salvando…' : '🔑 Definir senha e entrar'}
              </button>
              <button type="button" onClick={resetFlow} className="text-white/30 text-xs w-full text-center hover:text-white/50">
                ← Trocar usuário
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-white/20 text-xs mt-5">
          Copa GD 2026 · Grupo Digital SF
        </p>
      </div>
    </div>
  )
}
