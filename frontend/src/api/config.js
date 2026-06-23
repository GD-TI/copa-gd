// URL base do backend (vazio = mesmo domínio/origin)
// Em produção separada: VITE_API_URL=http://seu-servidor:3001
export const API_BASE = import.meta.env.VITE_API_URL || ''
