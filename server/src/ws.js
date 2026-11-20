import { WebSocketServer } from 'ws'
import { validateClientMessage, encode, Close } from './protocol.js'
import { createTokenBucket } from './ratelimit.js'

const JOIN_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 15000
const SLOW_CLIENT_BYTES = 256 * 1024

let nextPlayerId = 1

/**
 * WebSocket connection lifecycle:
 *   connect -> must send `join` within 5 s -> in a room -> close.
 * Every message is validated; bad ones close the socket with a code.
 */
export function attachWebSocket(server, { rooms, config, log = console }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxPayload })

  // Heartbeat: ping everyone every 15 s; two missed pongs -> terminate.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.missedPongs >= 2) {
        log.warn?.(`terminating dead socket player=${ws.player?.id}`)
        ws.terminate()
        continue
      }
      ws.missedPongs = (ws.missedPongs ?? 0) + 1
      ws.ping()
    }
  }, HEARTBEAT_MS)
  wss.on('close', () => clearInterval(heartbeat))

  /** Sends unless the client can't keep up. Non-critical messages are dropped for slow clients. */
  function send(ws, data, { critical = true } = {}) {
    if (ws.readyState !== ws.OPEN) return
    if (ws.bufferedAmount > SLOW_CLIENT_BYTES) {
      if (!critical) return
      if (ws.bufferedAmount > SLOW_CLIENT_BYTES * 4) return ws.close(Close.TOO_SLOW, 'too slow')
    }
    ws.send(data)
  }

  function broadcast(room, data, opts) {
    for (const p of room.players.values()) send(p.socket, data, opts)
  }

  function joinRoom(ws, msg) {
    let room = rooms.get(msg.room)
    if (!room) {
      try {
        room = rooms.create({ id: msg.room, name: msg.room })
        wireRoom(room)
      } catch {
        return ws.close(Close.SERVER_FULL, 'server full')
      }
    }
    if (room.full) return ws.close(Close.ROOM_FULL, 'room full')
    clearTimeout(ws.joinTimer)
    ws.player = { id: nextPlayerId++, name: msg.name, socket: ws }
    ws.room = room
    send(ws, encode('welcome', { playerId: ws.player.id, room: room.toJSON() }))
    room.join(ws.player)
  }

  function wireRoom(room) {
    if (room.wired) return
    room.wired = true
    const roster = () => broadcast(room, encode('roster', { players: room.roster() }))
    room.on('join', roster)
    room.on('leave', roster)
    room.on('chat', (m) => broadcast(room, encode('chat', m), { critical: false }))
  }

  for (const room of rooms.list()) wireRoom(room)
  rooms.on('created', wireRoom)

  wss.on('connection', (ws, req) => {
    ws.on('error', (e) => log.warn?.(`socket error: ${e.message}`)) // without this one bad socket crashes the server
    ws.on('pong', () => (ws.missedPongs = 0))
    ws.ip = req.socket.remoteAddress
    ws.bucket = createTokenBucket({ rate: config.msgRate, burst: config.msgBurst })
    ws.joinTimer = setTimeout(() => ws.close(Close.JOIN_TIMEOUT, 'join timeout'), JOIN_TIMEOUT_MS)

    ws.on('message', (data, isBinary) => {
      if (!ws.bucket.take()) return ws.close(Close.RATE_LIMIT, 'rate limit')
      if (isBinary) return ws.close(Close.BAD_MESSAGE, 'binary not supported in v0')
      const res = validateClientMessage(data.toString())
      if (!res.ok) {
        log.warn?.(`bad message from ${ws.ip}: ${res.reason}`)
        return ws.close(Close.BAD_MESSAGE, res.reason)
      }
      const msg = res.msg
      if (!ws.player) {
        if (msg.type !== 'join') return ws.close(Close.BAD_MESSAGE, 'join first')
        return joinRoom(ws, msg)
      }
      switch (msg.type) {
        case 'chat':
          return ws.room.chat(ws.player.id, msg.text)
        case 'leave':
          return ws.close(Close.NORMAL, 'bye')
        case 'join':
          return ws.close(Close.BAD_MESSAGE, 'already joined')
      }
    })

    ws.on('close', () => {
      clearTimeout(ws.joinTimer)
      if (ws.player && ws.room) ws.room.leave(ws.player.id)
    })
  })

  return {
    wss,
    /** Graceful shutdown: tell every client, close with 1001. */
    closeAll() {
      for (const ws of wss.clients) {
        send(ws, encode('shutdown'))
        ws.close(Close.GOING_AWAY, 'server shutting down')
      }
      clearInterval(heartbeat)
    },
  }
}
