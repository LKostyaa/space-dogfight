import http from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { loadConfig } from './config.js'
import { RoomManager } from './rooms.js'
import { attachWebSocket } from './ws.js'
import { startMatchLog } from './log/matchlog.js'
import { serveStatic } from './static.js'

const config = loadConfig()
const rooms = new RoomManager(config)
const matchLogs = new Map()

rooms.on('created', async (room) => {
  const log = await startMatchLog(room, config.logDir)
  matchLogs.set(room.id, log)
  log.done.catch((e) => console.error(`match log ${room.id} failed: ${e.message}`)).finally(() => matchLogs.delete(room.id))
})

for (const r of [
  { id: 'alpha', name: 'Alpha', arena: 'classic', persistent: true },
  { id: 'belt', name: 'Asteroid belt', arena: 'belt', persistent: true },
  { id: 'duel', name: 'Duel', arena: 'classic', maxPlayers: 2, persistent: true },
]) {
  rooms.create(r)
}

const MAX_BODY = 1024

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 })
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x')
  const route = `${req.method} ${url.pathname}`

  if (route === 'GET /health') {
    return json(res, 200, { ok: true, uptime: process.uptime(), rss: process.memoryUsage().rss })
  }
  if (route === 'GET /api/rooms') return json(res, 200, rooms.list())
  if (route === 'POST /api/rooms') {
    const body = await readBody(req)
    const id = String(body.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
    if (!id) return json(res, 400, { error: 'name required' })
    try {
      const room = rooms.create({ id, name: String(body.name).slice(0, 32), arena: body.arena === 'belt' ? 'belt' : 'classic' })
      return json(res, 201, room)
    } catch (e) {
      return json(res, 409, { error: e.message })
    }
  }
  if (route === 'GET /api/replays') {
    const files = (await readdir(config.logDir).catch(() => [])).filter((f) => f.endsWith('.ndjson'))
    return json(res, 200, files.map((f) => f.replace(/\.ndjson$/, '')))
  }
  const replay = url.pathname.match(/^\/api\/replays\/([a-z0-9-]+)$/)
  if (req.method === 'GET' && replay) {
    const file = path.join(config.logDir, `${replay[1]}.ndjson`)
    const info = await stat(file).catch(() => null)
    if (!info) return json(res, 404, { error: 'no such replay' })
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-length': info.size })
    // streamed with backpressure: never buffers the whole file
    return pipeline(createReadStream(file), res)
  }
  if (route === 'GET /api/slow') {
    // Deliberately blocks the event loop for 300 ms (README: event loop write-up)
    const until = performance.now() + 300
    while (performance.now() < until) {
      /* busy */
    }
    return json(res, 200, { blocked: 300 })
  }
  if (req.method === 'GET' && (await serveStatic(req, res, config.staticDir))) return
  json(res, 404, { error: 'not found' })
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e.code === 'ERR_STREAM_PREMATURE_CLOSE') return // client went away mid-download: not our error
    if (!res.headersSent) json(res, e.status ?? 500, { error: e.status ? e.message : 'internal error' })
    else res.destroy()
    if (!e.status) console.error(e)
  })
})

const ws = attachWebSocket(server, { rooms, config })

server.listen(config.port, config.host, () => {
  console.log(`server on http://${config.host}:${server.address().port}`)
})

let stopping = false
async function shutdown(signal) {
  if (stopping) return
  stopping = true
  console.log(`${signal}: shutting down`)
  server.close() // stop accepting new connections
  ws.closeAll() // tell clients, close with 1001
  const pending = [...matchLogs.values()]
  for (const log of pending) log.stop() // ends the pipeline -> flushes the file
  await Promise.allSettled(pending.map((l) => l.done))
  console.log('bye')
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
