import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { performance as perf } from 'node:perf_hooks'
import path from 'node:path'
import { z } from 'zod'
import { ARENAS, isArenaName } from '@dogfight/shared/sim/arenas.ts'
import { createRng } from '@dogfight/shared/sim/rng.ts'
import { loadConfig } from './config.ts'
import { logger, VERSION } from './logger.ts'
import { RoomManager } from './rooms.ts'
import { attachWebSocket } from './ws.ts'
import { startMatchLog, type MatchLog } from './log/matchlog.ts'
import { serveStatic } from './static.ts'
import { Match } from './match.ts'
import { Bot } from './bot.ts'
import { playerIds } from './ids.ts'
import { createCounters, createMetrics } from './metrics.ts'

// ---- crash on unknowns: log the stack and exit non-zero; the supervisor restarts a clean process ----
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'process.uncaught_exception')
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'process.unhandled_rejection')
  process.exit(1)
})

const config = loadConfig() // zod: throws (-> uncaughtException -> exit 1) on bad env
const rooms = new RoomManager(config)
const matchLogs = new Map<string, MatchLog>()
const counters = createCounters()
const metrics = createMetrics(counters, rooms)
let ready = false
let stopping = false

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// every room gets an authoritative Match (registered before the WebSocket layer wires the room)
rooms.on('created', (room) => {
  room.match = new Match(room, { ...ARENAS[room.arena], log: logger.child({ roomId: room.id }) })
  room.once('closed', () => room.match?.stop())
})

rooms.on('created', (room) => {
  startMatchLog(room, config.logDir)
    .then((log) => {
      matchLogs.set(room.id, log)
      return log.done.finally(() => matchLogs.delete(room.id))
    })
    .catch((err: unknown) => logger.error({ err, roomId: room.id }, 'matchlog.failed'))
})

const MAX_BODY = 1024
const CreateRoomBody = z.object({ name: z.string().min(1).max(32), arena: z.string().optional() })
let lastElu = perf.eventLoopUtilization()

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

  // liveness: the process answers
  if (route === 'GET /health') return json(res, 200, { ok: true, version: VERSION, uptime: process.uptime() })
  // readiness: it can take players (listening, not shutting down)
  if (route === 'GET /ready') return json(res, ready && !stopping ? 200 : 503, { ready: ready && !stopping, stopping })
  if (route === 'GET /metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics())
    return
  }
  if (route === 'GET /api/rooms') return json(res, 200, rooms.list())
  if (route === 'GET /api/stats') {
    const elu = perf.eventLoopUtilization(lastElu)
    lastElu = perf.eventLoopUtilization()
    return json(res, 200, {
      version: VERSION,
      net: { ...counters, rejected: Object.fromEntries(counters.rejected) },
      rss: process.memoryUsage().rss,
      elu: elu.utilization,
      rooms: rooms.list().map((r) => r.match?.stats()),
    })
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
    logger.info({ roomId: room.id, added }, 'bots.added')
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
  if (route === 'GET /api/slow' && process.env.NODE_ENV !== 'production') {
    // Deliberately blocks the event loop for 300 ms (README, Lab 4). Disabled in production.
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
    if (!(e instanceof HttpError)) logger.error({ err: e, url: req.url }, 'http.error')
  })
})
// keep-alive longer than typical proxy idle timeouts (60 s), so the proxy closes first
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000

const ws = attachWebSocket(server, { rooms, config, log: logger, counters })

rooms.create({ id: 'alpha', name: 'Alpha', arena: 'classic', persistent: true })
rooms.create({ id: 'belt', name: 'Asteroid belt', arena: 'belt', persistent: true })
rooms.create({ id: 'duel', name: 'Duel', arena: 'classic', maxPlayers: 2, persistent: true })

server.listen(config.port, config.host, () => {
  ready = true
  logger.info({ host: config.host, port: config.port, origins: config.allowedOrigins }, 'server.listening')
})

/**
 * SIGTERM (docker stop, a deploy, autoscaling): stop accepting, tell clients to
 * reconnect (shutdown + close 1001), flush match logs, exit 0 — well within the
 * supervisor's 10 s grace period. A hard deadline makes sure we never hang.
 */
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  const t0 = performance.now()
  logger.info({ signal }, 'server.shutdown_started')
  setTimeout(() => {
    logger.error('server.shutdown_deadline_exceeded')
    process.exit(1)
  }, 8000).unref()
  server.close() // stop accepting new connections
  ws.closeAll() // tell clients, close with 1001
  const pending = [...matchLogs.values()]
  for (const log of pending) log.stop() // ends the pipeline -> flushes the file
  await Promise.allSettled(pending.map((l) => l.done))
  logger.info({ ms: Math.round(performance.now() - t0) }, 'server.shutdown_done')
  logger.flush(() => process.exit(0))
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
