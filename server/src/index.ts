import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { z } from 'zod'
import { ARENAS, isArenaName } from '@dogfight/shared/sim/arenas.ts'
import { loadConfig } from './config.ts'
import { RoomManager } from './rooms.ts'
import { attachWebSocket, type NetStats } from './ws.ts'
import { startMatchLog, type MatchLog } from './log/matchlog.ts'
import { serveStatic } from './static.ts'
import { Match } from './match.ts'
import { Bot } from './bot.ts'
import { createRng } from '@dogfight/shared/sim/rng.ts'
import { playerIds } from './ids.ts'
import { performance as perf } from 'node:perf_hooks'

const config = loadConfig()
const rooms = new RoomManager(config)
const matchLogs = new Map<string, MatchLog>()
const netStats: NetStats = { bytesOut: 0, bytesIn: 0, messagesIn: 0 }

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// every room gets an authoritative Match (registered before the WebSocket layer wires the room)
rooms.on('created', (room) => {
  room.match = new Match(room, { ...ARENAS[room.arena], log: console })
  room.once('closed', () => room.match?.stop())
})

rooms.on('created', (room) => {
  startMatchLog(room, config.logDir)
    .then((log) => {
      matchLogs.set(room.id, log)
      return log.done.finally(() => matchLogs.delete(room.id))
    })
    .catch((e: unknown) => console.error(`match log ${room.id} failed: ${e instanceof Error ? e.message : String(e)}`))
})

rooms.create({ id: 'alpha', name: 'Alpha', arena: 'classic', persistent: true })
rooms.create({ id: 'belt', name: 'Asteroid belt', arena: 'belt', persistent: true })
rooms.create({ id: 'duel', name: 'Duel', arena: 'classic', maxPlayers: 2, persistent: true })

const MAX_BODY = 1024
let lastElu = perf.eventLoopUtilization()
const CreateRoomBody = z.object({ name: z.string().min(1).max(32), arena: z.string().optional() })

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += b.length
    if (size > MAX_BODY) throw new HttpError(413, 'body too large')
    chunks.push(b)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    throw new HttpError(400, 'bad json')
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x')
  const route = `${req.method} ${url.pathname}`

  if (route === 'GET /health') {
    return json(res, 200, { ok: true, uptime: process.uptime(), rss: process.memoryUsage().rss })
  }
  if (route === 'GET /api/rooms') return json(res, 200, rooms.list())
  if (route === 'GET /api/stats') {
    const elu = perf.eventLoopUtilization(lastElu)
    lastElu = perf.eventLoopUtilization()
    return json(res, 200, { net: netStats, rss: process.memoryUsage().rss, elu: elu.utilization, rooms: rooms.list().map((r) => r.match?.stats()) })
  }
  const bots = /^\/api\/rooms\/([a-z0-9-]+)\/bots$/.exec(url.pathname)
  if (req.method === 'DELETE' && bots?.[1]) {
    const room = rooms.get(bots[1])
    if (!room?.match) return json(res, 404, { error: 'no such room' })
    const removed = room.match.removeBots()
    for (const id of removed) {
      room.leave(id)
      playerIds.release(id)
    }
    return json(res, 200, { removed: removed.length })
  }
  if (req.method === 'POST' && bots?.[1]) {
    const room = rooms.get(bots[1])
    if (!room?.match) return json(res, 404, { error: 'no such room' })
    const body = z.object({ count: z.number().int().min(1).max(8) }).safeParse(await readBody(req))
    if (!body.success) return json(res, 400, { error: 'count: 1..8' })
    let added = 0
    for (let i = 0; i < body.data.count && !room.full; i++, added++) {
      const id = playerIds.take()
      if (id === null) break
      room.match.addPlayer({ id, name: `bot-${id}`, ai: new Bot(createRng(id)) })
      room.join({ id, name: `bot-${id}`, socket: null })
    }
    return json(res, 201, { added, players: room.players.size })
  }
  if (route === 'POST /api/rooms') {
    const body = CreateRoomBody.safeParse(await readBody(req))
    if (!body.success) return json(res, 400, { error: 'name required (1–32 chars)' })
    const id = body.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
    if (!id) return json(res, 400, { error: 'name must contain letters or digits' })
    try {
      const arena = body.data.arena && isArenaName(body.data.arena) ? body.data.arena : 'classic'
      return json(res, 201, rooms.create({ id, name: body.data.name, arena }))
    } catch (e: unknown) {
      return json(res, 409, { error: e instanceof Error ? e.message : 'conflict' })
    }
  }
  if (route === 'GET /api/replays') {
    const files = (await readdir(config.logDir).catch(() => [])).filter((f) => f.endsWith('.ndjson'))
    return json(res, 200, files.map((f) => f.replace(/\.ndjson$/, '')))
  }
  const replay = /^\/api\/replays\/([a-z0-9-]+)$/.exec(url.pathname)
  if (req.method === 'GET' && replay?.[1]) {
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
  if (req.method === 'GET' && (await serveStatic(req.url ?? '/', res, config.staticDir))) return
  json(res, 404, { error: 'not found' })
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && e.code === 'ERR_STREAM_PREMATURE_CLOSE') return // client went away mid-download
    const status = e instanceof HttpError ? e.status : 500
    if (!res.headersSent) json(res, status, { error: e instanceof HttpError ? e.message : 'internal error' })
    else res.destroy()
    if (!(e instanceof HttpError)) console.error(e)
  })
})

const ws = attachWebSocket(server, { rooms, config, stats: netStats })

server.listen(config.port, config.host, () => {
  console.log(`server on http://${config.host}:${config.port}`)
})

let stopping = false
async function shutdown(signal: string): Promise<void> {
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
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
