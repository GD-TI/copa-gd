/**
 * Aviso curto no canto da tela.
 *
 * Estava copiado em `ShellConfig.jsx` e `ShellCampaigns.jsx`, com a mesma
 * implementação nos dois — este arquivo é a cópia única.
 */
export function showToast(msg, ok = true) {
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

export default showToast
