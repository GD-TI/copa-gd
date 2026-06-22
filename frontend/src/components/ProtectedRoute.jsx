import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #F5F5F7)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚽</div>
          <div style={{ color: 'var(--txt3, #A1A1AA)', fontFamily: 'sans-serif', fontSize: 13 }}>Carregando...</div>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (role && user.role !== role) {
    return <Navigate to="/" replace />
  }

  return children
}
