import { useState, useEffect } from 'react'
import api from '../api/client'
import { useAuth } from '../contexts/AuthContext'

function ini(name = '') {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

export default function ShellMyGroup() {
  const { user } = useAuth()
  const [groupDetail, setGroupDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  const myGroup = user?.group

  useEffect(() => {
    if (!myGroup?.id) {
      setGroupDetail(null)
      return
    }
    setLoading(true)
    api.get(`/groups/${myGroup.id}`)
      .then(r => setGroupDetail(r.data))
      .catch(() => setGroupDetail(null))
      .finally(() => setLoading(false))
  }, [myGroup?.id])

  if (!myGroup) {
    return (
      <div className="pw">
        <div className="sec-label">⚽ Meu Grupo</div>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👤</div>
          <div style={{ font: '700 14px/1.4 var(--font)', color: 'var(--txt)', marginBottom: 8 }}>
            Você ainda não está em uma equipe
          </div>
          <p style={{ font: '400 12px/1.5 var(--font)', color: 'var(--txt3)', margin: 0 }}>
            O administrador irá cadastrá-lo e atribuí-lo a uma equipe. Entre em contato com o ADM.
          </p>
        </div>
      </div>
    )
  }

  const members = groupDetail?.members || []

  return (
    <div className="pw">
      <div className="sec-label">⚽ Meu Grupo</div>
      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--surf3)', border: '2px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            font: '700 18px/1 var(--display)', color: 'var(--txt2)',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {myGroup.photo_url
              ? <img src={myGroup.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : ini(myGroup.name)}
          </div>
          <div>
            <div style={{ font: '700 16px/1 var(--font)', color: 'var(--txt)', marginBottom: 4 }}>
              {myGroup.name}
            </div>
            <div style={{ font: '400 11px/1 var(--font)', color: 'var(--txt3)' }}>
              {members.length}/5 integrantes
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ font: '700 9px/1 var(--font)', color: 'var(--txt3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
            Integrantes
          </div>

          {loading && (
            <div style={{ color: 'var(--txt3)', fontSize: 13, padding: '8px 0' }}>Carregando…</div>
          )}

          {!loading && members.map(m => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'var(--surf3)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                font: '700 12px/1 var(--display)', color: 'var(--txt2)', flexShrink: 0,
              }}>
                {ini(m.display_name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ font: '600 13px/1 var(--font)', color: 'var(--txt)' }}>
                  {m.display_name}
                  {m.id === user?.id && <span style={{ color: 'var(--gold)', fontSize: 10, marginLeft: 6 }}>você</span>}
                </div>
                {m.corban_username && (
                  <div style={{ font: '400 10px/1 var(--font)', color: 'var(--txt3)', marginTop: 2 }}>
                    @{m.corban_username}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
