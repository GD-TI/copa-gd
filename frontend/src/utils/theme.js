const THEME_KEY = 'copa_theme'
const MAX_AGE = 365 * 24 * 60 * 60 // 1 ano

export function readThemeCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_KEY}=(light|dark)`))
  return m ? m[1] : 'light'
}

export function writeThemeCookie(theme) {
  document.cookie = `${THEME_KEY}=${theme};path=/;max-age=${MAX_AGE};SameSite=Lax`
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function initTheme() {
  const theme = readThemeCookie()
  applyTheme(theme)
  return theme
}
