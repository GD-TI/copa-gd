const router = require('express').Router()

const clients = new Set()

// GET /api/events/stream — SSE: sem auth (só envia notificação, dados vêm de endpoints autenticados)
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // desativa buffer do nginx se houver
  res.flushHeaders()

  res.write('event: connected\ndata: {}\n\n')

  clients.add(res)
  console.log(`[SSE] +1 cliente. Total: ${clients.size}`)

  const keepAlive = setInterval(() => {
    try { res.write(':ping\n\n') } catch (_) {}
  }, 25000)

  req.on('close', () => {
    clearInterval(keepAlive)
    clients.delete(res)
    console.log(`[SSE] -1 cliente. Total: ${clients.size}`)
  })
})

function broadcast(event, data = {}) {
  if (clients.size === 0) return
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const dead = []
  clients.forEach(res => {
    try { res.write(msg) }
    catch (_) { dead.push(res) }
  })
  dead.forEach(r => clients.delete(r))
  console.log(`[SSE] broadcast '${event}' → ${clients.size} cliente(s)`)
}

module.exports = { router, broadcast }
