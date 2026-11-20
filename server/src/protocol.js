/**
 * Protocol v0 — JSON messages with a `type`. Every incoming message goes
 * through validateClientMessage(); anything unknown or malformed is rejected.
 *
 * client -> server: join { room, name } | chat { text } | leave {}
 * server -> client: welcome { playerId, room } | roster { players } | chat { from, text, t }
 *                   error { code, message } | shutdown {}
 */
export const PROTOCOL_VERSION = 0

/** WebSocket close codes (4000–4999 are free for applications). */
export const Close = Object.freeze({
  NORMAL: 1000,
  GOING_AWAY: 1001,
  BAD_MESSAGE: 4000,
  JOIN_TIMEOUT: 4001,
  RATE_LIMIT: 4002,
  ROOM_FULL: 4003,
  TOO_SLOW: 4004,
  SERVER_FULL: 4005,
})

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const NAME_RE = /^[\p{L}\p{N} _.-]+$/u

const validators = {
  join: (m) => isStr(m.room, 32) && /^[a-z0-9-]+$/.test(m.room) && isStr(m.name, 16) && NAME_RE.test(m.name),
  chat: (m) => isStr(m.text, 200),
  leave: () => true,
}

/** Returns { ok: true, msg } or { ok: false, reason }. Never throws. */
export function validateClientMessage(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'not json' }
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return { ok: false, reason: 'not an object' }
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, reason: `unsupported version ${msg.v}` }
  const check = validators[msg.type]
  if (!check) return { ok: false, reason: `unknown type ${String(msg.type).slice(0, 20)}` }
  if (!check(msg)) return { ok: false, reason: `bad ${msg.type}` }
  return { ok: true, msg }
}

export const encode = (type, body = {}) => JSON.stringify({ v: PROTOCOL_VERSION, type, ...body })
