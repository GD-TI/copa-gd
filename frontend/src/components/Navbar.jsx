import { Link, useNavigate, useLocation } from 'react-router-dom'
import { LogOut, Trophy, Users, Settings, Home, Star, Calendar } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActive = (path) => location.pathname === path

  const playerLinks = [
    { to: '/', icon: <Home size={16} />, label: 'Placar' },
    { to: '/ranking', icon: <Trophy size={16} />, label: 'Ranking' },
    { to: '/my-group', icon: <Users size={16} />, label: 'Meu Grupo' },
  ]

  const adminLinks = [
    { to: '/admin', icon: <Home size={16} />, label: 'Painel' },
    { to: '/ranking', icon: <Trophy size={16} />, label: 'Ranking' },
    { to: '/admin/users', icon: <Users size={16} />, label: 'Jogadores' },
    { to: '/admin/groups', icon: <Trophy size={16} />, label: 'Grupos' },
    { to: '/admin/scores', icon: <Star size={16} />, label: 'Pontuação' },
    { to: '/admin/campaign', icon: <Calendar size={16} />, label: 'Campanha' },
    { to: '/admin/worldcup', icon: <span className="text-sm">🇧🇷</span>, label: 'Copa' },
  ]

  const links = user?.role === 'admin' ? adminLinks : playerLinks

  return (
    <nav className="bg-copa-navy-light border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to={user?.role === 'admin' ? '/admin' : '/'} className="flex items-center gap-2 group">
            <span className="text-2xl">🏆</span>
            <div>
              <span className="text-copa-yellow font-black text-lg leading-none">COPA</span>
              <span className="text-copa-green font-black text-lg leading-none ml-1">GD</span>
              <span className="text-white/60 font-bold text-sm ml-1">2026</span>
            </div>
          </Link>

          {/* Links centrais */}
          <div className="hidden sm:flex items-center gap-1">
            {links.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(link.to)
                    ? 'bg-copa-green text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {link.icon}
                {link.label}
              </Link>
            ))}
          </div>

          {/* Usuário */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-white font-medium text-sm leading-none">
                {user?.display_name || user?.username}
              </span>
              <span className={`text-xs font-semibold mt-0.5 ${
                user?.role === 'admin' ? 'text-copa-yellow' : 'text-copa-green'
              }`}>
                {user?.role === 'admin' ? '⚙️ Admin' : '⚽ Jogador'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
              title="Sair"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Menu mobile */}
        <div className="sm:hidden flex gap-1 pb-2 overflow-x-auto">
          {links.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive(link.to)
                  ? 'bg-copa-green text-white'
                  : 'text-white/60 hover:text-white bg-white/5'
              }`}
            >
              {link.icon}
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
