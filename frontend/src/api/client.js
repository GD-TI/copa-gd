import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// Injetar token em todas as requisições
api.interceptors.request.use(config => {
  const token = localStorage.getItem('copa_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirecionar para login se 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('copa_token')
      localStorage.removeItem('copa_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
