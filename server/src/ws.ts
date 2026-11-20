import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import { getCodec, CodecError } from '@dogfight/shared/codec/index.ts'
import { TICK_RATE } from '@dogfight/shared/sim/constants.ts'
import { parseClientMessage, encodeServerMessage, type CodecName, type ClientMessage } from '@dogfight/shared/protocol.ts'
import { assertNever, type PlayerId, type Seq } from '@dogfight/shared/types.ts'
import { Close } from './protocol.ts'
import { createTokenBucket, type TokenBucket } from './ratelimit.ts'
import { startHeartbeat } from './heartbeat.ts'
import { playerIds } from './ids.ts'
import { reject, type NetCounters } from './metrics.ts'
import type { Logger } from './logger.ts'
import type { Room, RoomManager } from './rooms.ts'
import type { ServerConfig } from './config.ts'

const JOIN_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 15000
const SLOW_CLIENT_BYTES = 256 * 1024

/** Per-connection state (instead of monkey-patching fields onto the socket). */
interface Conn {
  readonly ws: WebSocket
  readonly ip: string
  readonly bucket: TokenBucket
  joinTimer: NodeJS.Timeout | undefined
  missedPongs: number
  player: { id: PlayerId; name: string } | null
  room: Room | null
  codec: CodecName
  log: Logger
  /** set once we decided to close: frames already in flight are ignored (and not counted twice) */
  closing: boolean
}

/** RawData can be a Buffer, ArrayBuffer or Buffer[] — normalize to an ArrayBuffer for the codec. */
function toArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  const buf = Array.isArray(data) ? Buffer.concat(data) : data
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return out
}

export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: boolean): string {
  const forwarded = req.headers['x-forwarded-for']
  if (trustProxy && typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() || '?'
  return req.socket.remoteAddress ?? '?'
}

/** Browsers always send Origin on a WebSocket handshake; CORS does not apply to WebSockets, so we check it ourselves. */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true // not a browser (load test, curl): Origin can't stop scripts anyway — rate/IP limits do
  if (allowed.length === 0) return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) // dev default
  return allowed.includes(origin)
}

/**
 * WebSocket connection lifecycle:
 *   handshake (Origin + per-IP cap) -> must send `join` within 5 s -> in a room (match) -> close.
 * Every message is validated; bad ones close the socket with a code, are logged and counted.
 */
export function attachWebSocket(server: HttpServer, { rooms, config, log, counters }: { rooms: RoomManager; config: ServerConfig; log: Logger; counters: NetCounters }) {
  const perIp = new Map<string, number>()

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: config.maxPayload,
    verifyClient: ({ origin, req }, done) => {
      if (!originAllowed(origin, config.allowedOrigins)) {
        reject(counters, 'origin')
        log.warn({ origin, reason: 'origin' }, 'ws.rejected')
        return done(false, 403, 'origin not allowed')
      }
      const ip = clientIp(req, config.trustProxy)
      if ((perIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
        reject(counters, 'ip_cap')
        log.warn({ ip, reason: 'ip_cap' }, 'ws.rejected')
        return done(false, 429, 'too many connections')
      }
      done(true)
    },
  })
  const conns = new Set<Conn>()

  // Heartbeat: ping everyone every 15 s; two missed pongs -> terminate.
  const stopHeartbeat = startHeartbeat(
    function* () {
      for (const c of conns) yield { get missedPongs() { return c.missedPongs }, set missedPongs(v: number) { c.missedPongs = v }, ping: () => c.ws.ping(), terminate: () => c.ws.terminate() }
    },
    { intervalMs: HEARTBEAT_MS, onDead: () => log.warn('ws.dead') },
  )
  wss.on('close', stopHeartbeat)

  function closeWith(c: Conn, code: number, reason: Parameters<typeof reject>[1], detail = ''): void {
    if (c.closing) return
    c.closing = true
    reject(counters, reason)
    c.log.warn({ reason, detail: detail.slice(0, 120) }, 'ws.closed_by_server')
    c.ws.close(code, (detail || reason).slice(0, 120))
  }

  /** Sends unless the client can't keep up. Non-critical messages are dropped for slow clients. */
  function send(ws: WebSocket, data: string | ArrayBuffer, { critical = true } = {}): void {
    if (ws.readyState !== ws.OPEN) return
    if (ws.bufferedAmount > SLOW_CLIENT_BYTES) {
      if (!critical) return
      if (ws.bufferedAmount > SLOW_CLIENT_BYTES * 4) {
        reject(counters, 'too_slow')
        return ws.close(Close.TOO_SLOW, 'too slow')
      }
    }
    counters.messagesOut++
    counters.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
    ws.send(data)
  }

  function broadcast(room: Room, data: string, opts?: { critical?: boolean }): void {
    for (const p of room.players.values()) if (p.socket) send(p.socket, data, opts)
  }

  function rosterOf(room: Room) {
    return room.roster().map((p) => {
      const color = room.match?.players.get(p.id)?.ship.color
      return color ? { ...p, color } : p
    })
  }

  function wireRoom(room: Room): void {
    if (room.wired || !room.match) return
    room.wired = true
    log.info({ roomId: room.id }, 'room.created')
    room.match.onBroadcast = (snapshot, players) => {
      // encode once per codec per tick, then patch each client's ack
      const prepared = new Map<CodecName, (ack: Seq) => string | ArrayBuffer>()
      for (const p of players) {
        if (!p.socket) continue
        let make = prepared.get(p.codec)
        if (!make) prepared.set(p.codec, (make = getCodec(p.codec).prepareSnapshot(snapshot)))
        send(p.socket, make(p.lastSeq), { critical: false })
      }
    }
    const roster = (): void => broadcast(room, encodeServerMessage({ v: 1, type: 'roster', players: rosterOf(room) }))
    room.on('join', roster)
    room.on('leave', roster)
    room.on('chat', (m) => broadcast(room, encodeServerMessage({ v: 1, type: 'chat', ...m }), { critical: false }))
  }

  for (const room of rooms.list()) wireRoom(room)
  rooms.on('created', wireRoom)
  rooms.on('deleted', (room) => log.info({ roomId: room.id }, 'room.deleted'))

  function joinRoom(c: Conn, msg: Extract<ClientMessage, { type: 'join' }>): void {
    let room = rooms.get(msg.room)
    if (!room) {
      try {
        room = rooms.create({ id: msg.room, name: msg.room })
      } catch {
        return closeWith(c, Close.SERVER_FULL, 'server_full')
      }
    }
    if (room.full || !room.match) return closeWith(c, Close.ROOM_FULL, 'room_full')
    const id = playerIds.take()
    if (id === null) return closeWith(c, Close.SERVER_FULL, 'server_full')
    clearTimeout(c.joinTimer)
    c.player = { id, name: msg.name }
    c.codec = msg.codec ?? 'binary'
    c.room = room
    c.log = c.log.child({ roomId: room.id, playerId: id })
    send(c.ws, encodeServerMessage({ v: 1, type: 'welcome', playerId: id, room: room.toJSON(), tickRate: TICK_RATE, codec: c.codec }))
    room.match.addPlayer({ id, name: msg.name, codec: c.codec, socket: c.ws })
    room.join({ id, name: msg.name, socket: c.ws })
    c.log.info({ codec: c.codec }, 'player.joined')
  }

  function handle(c: Conn, msg: ClientMessage): void {
    if (!c.player || !c.room) {
      if (msg.type !== 'join') return closeWith(c, Close.BAD_MESSAGE, 'bad_message', 'join first')
      return joinRoom(c, msg)
    }
    switch (msg.type) {
      case 'input':
        return c.room.match?.queueInput(c.player.id, { seq: msg.seq, bits: msg.b })
      case 'chat':
        return c.room.chat(c.player.id, msg.text)
      case 'ping':
        return send(c.ws, encodeServerMessage({ v: 1, type: 'pong', t: msg.t }))
      case 'leave':
        return c.ws.close(Close.NORMAL, 'bye')
      case 'join':
        return closeWith(c, Close.BAD_MESSAGE, 'bad_message', 'already joined')
      default:
        return assertNever(msg, 'client message')
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req, config.trustProxy)
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1)
    counters.connections++
    const c: Conn = {
      ws,
      ip,
      bucket: createTokenBucket({ rate: config.msgRate, burst: config.msgBurst }),
      joinTimer: setTimeout(() => closeWith(c, Close.JOIN_TIMEOUT, 'join_timeout'), JOIN_TIMEOUT_MS),
      missedPongs: 0,
      player: null,
      room: null,
      codec: 'binary',
      log: log.child({ ip }),
      closing: false,
    }
    conns.add(c)
    ws.on('error', (e) => c.log.warn({ err: e }, 'ws.error')) // without this one bad socket crashes the server
    ws.on('pong', () => (c.missedPongs = 0))

    ws.on('message', (data, isBinary) => {
      if (c.closing) return
      counters.messagesIn++
      counters.bytesIn += Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data.byteLength
      if (!c.bucket.take()) return closeWith(c, Close.RATE_LIMIT, 'rate_limit')

      if (isBinary) {
        if (!c.player || !c.room?.match || c.codec !== 'binary') return closeWith(c, Close.BAD_MESSAGE, 'bad_message', 'unexpected binary')
        try {
          return c.room.match.queueInput(c.player.id, getCodec('binary').decodeInput(toArrayBuffer(data)))
        } catch (e: unknown) {
          if (!(e instanceof CodecError)) throw e
          return closeWith(c, Close.BAD_MESSAGE, 'bad_message', e.message)
        }
      }

      const res = parseClientMessage(Buffer.from(toArrayBuffer(data)).toString('utf8'))
      if (!res.ok) return closeWith(c, Close.BAD_MESSAGE, 'bad_message', res.error)
      handle(c, res.value)
    })

    ws.on('close', (code) => {
      conns.delete(c)
      counters.connections--
      const n = (perIp.get(ip) ?? 1) - 1
      if (n <= 0) perIp.delete(ip)
      else perIp.set(ip, n)
      clearTimeout(c.joinTimer)
      if (c.player && c.room) {
        c.room.match?.removePlayer(c.player.id)
        c.room.leave(c.player.id)
        playerIds.release(c.player.id)
        c.log.info({ code }, 'player.left')
      }
    })
  })

  return {
    wss,
    /** Graceful shutdown: tell every client, close with 1001. */
    closeAll(): void {
      for (const c of conns) {
        send(c.ws, encodeServerMessage({ v: 1, type: 'shutdown' }))
        c.ws.close(Close.GOING_AWAY, 'server shutting down')
      }
      stopHeartbeat()
    },
  }
}
