import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket, type RawData } from 'ws'
import { getCodec, CodecError } from '@dogfight/shared/codec/index.ts'
import { TICK_RATE } from '@dogfight/shared/sim/constants.ts'
import { parseClientMessage, encodeServerMessage, type CodecName, type ClientMessage } from '@dogfight/shared/protocol.ts'
import { toId, assertNever, type PlayerId } from '@dogfight/shared/types.ts'
import { Close } from './protocol.ts'
import { createTokenBucket, type TokenBucket } from './ratelimit.ts'
import type { Room, RoomManager } from './rooms.ts'
import type { MatchPlayer } from './match.ts'
import type { ServerConfig } from './config.ts'

const JOIN_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 15000
const SLOW_CLIENT_BYTES = 256 * 1024

let nextPlayerId = 1

export interface NetStats {
  bytesOut: number
  bytesIn: number
  messagesIn: number
}

interface Logger {
  warn(msg: string): void
}

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
}

/** RawData can be a Buffer, ArrayBuffer or Buffer[] — normalize to an ArrayBuffer for the codec. */
function toArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  const buf = Array.isArray(data) ? Buffer.concat(data) : data
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return out
}

/**
 * WebSocket connection lifecycle:
 *   connect -> must send `join` within 5 s -> in a room (match) -> close.
 * Every message is validated; bad ones close the socket with a code.
 */
export function attachWebSocket(
  server: HttpServer,
  { rooms, config, log = console, stats = { bytesOut: 0, bytesIn: 0, messagesIn: 0 } }: { rooms: RoomManager; config: ServerConfig; log?: Logger; stats?: NetStats },
) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayload })
  const conns = new Set<Conn>()

  // Heartbeat: ping everyone every 15 s; two missed pongs -> terminate.
  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (c.missedPongs >= 2) {
        log.warn(`terminating dead socket player=${c.player?.id}`)
        c.ws.terminate()
        continue
      }
      c.missedPongs++
      c.ws.ping()
    }
  }, HEARTBEAT_MS)
  wss.on('close', () => clearInterval(heartbeat))

  /** Sends unless the client can't keep up. Non-critical messages are dropped for slow clients. */
  function send(ws: WebSocket, data: string | ArrayBuffer, { critical = true } = {}): void {
    if (ws.readyState !== ws.OPEN) return
    if (ws.bufferedAmount > SLOW_CLIENT_BYTES) {
      if (!critical) return
      if (ws.bufferedAmount > SLOW_CLIENT_BYTES * 4) return ws.close(Close.TOO_SLOW, 'too slow')
    }
    stats.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
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
    room.match.onSend = (player: MatchPlayer, snapshot) => {
      if (player.socket) send(player.socket, getCodec(player.codec).encodeSnapshot(snapshot), { critical: false })
    }
    const roster = (): void => broadcast(room, encodeServerMessage({ v: 1, type: 'roster', players: rosterOf(room) }))
    room.on('join', roster)
    room.on('leave', roster)
    room.on('chat', (m) => broadcast(room, encodeServerMessage({ v: 1, type: 'chat', ...m }), { critical: false }))
  }

  for (const room of rooms.list()) wireRoom(room)
  rooms.on('created', wireRoom)

  function joinRoom(c: Conn, msg: Extract<ClientMessage, { type: 'join' }>): void {
    let room = rooms.get(msg.room)
    if (!room) {
      try {
        room = rooms.create({ id: msg.room, name: msg.room })
      } catch {
        return c.ws.close(Close.SERVER_FULL, 'server full')
      }
    }
    if (room.full || !room.match) return c.ws.close(Close.ROOM_FULL, 'room full')
    clearTimeout(c.joinTimer)
    const id = toId<PlayerId>(nextPlayerId++)
    c.player = { id, name: msg.name }
    c.codec = msg.codec ?? 'binary'
    c.room = room
    send(c.ws, encodeServerMessage({ v: 1, type: 'welcome', playerId: id, room: room.toJSON(), tickRate: TICK_RATE, codec: c.codec }))
    room.match.addPlayer({ id, name: msg.name, codec: c.codec, socket: c.ws })
    room.join({ id, name: msg.name, socket: c.ws })
  }

  function handle(c: Conn, msg: ClientMessage): void {
    if (!c.player || !c.room) {
      if (msg.type !== 'join') return c.ws.close(Close.BAD_MESSAGE, 'join first')
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
        return c.ws.close(Close.BAD_MESSAGE, 'already joined')
      default:
        return assertNever(msg, 'client message')
    }
  }

  wss.on('connection', (ws, req) => {
    const c: Conn = {
      ws,
      ip: req.socket.remoteAddress ?? '?',
      bucket: createTokenBucket({ rate: config.msgRate, burst: config.msgBurst }),
      joinTimer: setTimeout(() => ws.close(Close.JOIN_TIMEOUT, 'join timeout'), JOIN_TIMEOUT_MS),
      missedPongs: 0,
      player: null,
      room: null,
      codec: 'binary',
    }
    conns.add(c)
    ws.on('error', (e) => log.warn(`socket error: ${e.message}`)) // without this one bad socket crashes the server
    ws.on('pong', () => (c.missedPongs = 0))

    ws.on('message', (data, isBinary) => {
      stats.messagesIn++
      stats.bytesIn += Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data.byteLength
      if (!c.bucket.take()) return ws.close(Close.RATE_LIMIT, 'rate limit')

      if (isBinary) {
        if (!c.player || !c.room?.match || c.codec !== 'binary') return ws.close(Close.BAD_MESSAGE, 'unexpected binary')
        try {
          return c.room.match.queueInput(c.player.id, getCodec('binary').decodeInput(toArrayBuffer(data)))
        } catch (e: unknown) {
          if (!(e instanceof CodecError)) throw e
          log.warn(`bad binary from ${c.ip}: ${e.message}`)
          return ws.close(Close.BAD_MESSAGE, e.message)
        }
      }

      const res = parseClientMessage(Buffer.from(toArrayBuffer(data)).toString('utf8'))
      if (!res.ok) {
        log.warn(`bad message from ${c.ip}: ${res.error}`)
        return ws.close(Close.BAD_MESSAGE, res.error.slice(0, 120))
      }
      handle(c, res.value)
    })

    ws.on('close', () => {
      conns.delete(c)
      clearTimeout(c.joinTimer)
      if (c.player && c.room) {
        c.room.match?.removePlayer(c.player.id)
        c.room.leave(c.player.id)
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
      clearInterval(heartbeat)
    },
  }
}
