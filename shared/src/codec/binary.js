import {
  PROTOCOL_VERSION,
  BinaryType,
  KIND_CODE,
  KIND_NAME,
  EVENT_CODE,
  EVENT_NAME,
  EFFECTS,
} from '../protocol/messages.js'
import { CodecError } from './errors.js'

/**
 * Binary codec with DataView, little-endian. Layout: docs/protocol.md.
 * Quantization: position u16 = x·40 (0.025 px), velocity i16 = v·16,
 * angle u16 = angle/2π·65536.
 */
const LE = true
const POS = 40
const VEL = 16
const TAU = Math.PI * 2

export const SIZES = Object.freeze({ HEADER: 13, ship: 18, bullet: 15, asteroid: 11, pickup: 8, EVENT: 8, INPUT: 6 })

const qPos = (v) => Math.max(0, Math.min(65535, Math.round(v * POS)))
const qVel = (v) => Math.max(-32768, Math.min(32767, Math.round(v * VEL)))
const qAngle = (a) => Math.round((((a % TAU) + TAU) % TAU) * (65536 / TAU)) & 0xffff
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)))

export function snapshotSize(snap) {
  let n = SIZES.HEADER + snap.events.length * SIZES.EVENT
  for (const e of snap.entities) n += SIZES[e.kind]
  return n
}

export function encodeSnapshot(snap) {
  if (snap.entities.length > 65535 || snap.events.length > 255) throw new CodecError('snapshot too large')
  const buf = new ArrayBuffer(snapshotSize(snap))
  const dv = new DataView(buf)
  let o = 0
  dv.setUint8(o, BinaryType.SNAPSHOT)
  dv.setUint8(o + 1, PROTOCOL_VERSION)
  dv.setUint32(o + 2, snap.tick >>> 0, LE)
  dv.setUint32(o + 6, (snap.ack ?? 0) >>> 0, LE)
  dv.setUint16(o + 10, snap.entities.length, LE)
  dv.setUint8(o + 12, snap.events.length)
  o += SIZES.HEADER
  for (const e of snap.entities) {
    dv.setUint8(o, KIND_CODE[e.kind])
    dv.setUint16(o + 1, e.id & 0xffff, LE)
    o += 3
    switch (e.kind) {
      case 'ship':
        dv.setUint8(o, e.playerId & 0xff)
        dv.setUint16(o + 1, qPos(e.x), LE)
        dv.setUint16(o + 3, qPos(e.y), LE)
        dv.setInt16(o + 5, qVel(e.vx), LE)
        dv.setInt16(o + 7, qVel(e.vy), LE)
        dv.setUint16(o + 9, qAngle(e.angle), LE)
        dv.setUint8(o + 11, u8(e.hp))
        dv.setUint8(o + 12, e.flags & 0xff)
        dv.setUint16(o + 13, Math.min(65535, e.score), LE)
        o += 15
        break
      case 'bullet':
        dv.setUint8(o, e.owner & 0xff)
        dv.setUint16(o + 1, e.seq & 0xffff, LE)
        dv.setUint16(o + 3, qPos(e.x), LE)
        dv.setUint16(o + 5, qPos(e.y), LE)
        dv.setInt16(o + 7, qVel(e.vx), LE)
        dv.setInt16(o + 9, qVel(e.vy), LE)
        dv.setUint8(o + 11, e.homing ? 1 : 0)
        o += 12
        break
      case 'asteroid':
        dv.setUint16(o, qPos(e.x), LE)
        dv.setUint16(o + 2, qPos(e.y), LE)
        dv.setUint16(o + 4, qAngle(e.angle), LE)
        dv.setUint8(o + 6, u8(e.radius))
        dv.setUint8(o + 7, e.homing ? 1 : 0)
        o += 8
        break
      case 'pickup':
        dv.setUint16(o, qPos(e.x), LE)
        dv.setUint16(o + 2, qPos(e.y), LE)
        dv.setUint8(o + 4, Math.max(0, EFFECTS.indexOf(e.effect)))
        o += 5
        break
      default:
        throw new CodecError(`unknown kind ${e.kind}`)
    }
  }
  for (const ev of snap.events) {
    dv.setUint8(o, EVENT_CODE[ev.type] ?? 0)
    const sub = ev.type === 'pickup' ? EFFECTS.indexOf(ev.effect) : (KIND_CODE[ev.kind] ?? 0)
    dv.setUint8(o + 1, Math.max(0, sub))
    dv.setUint16(o + 2, qPos(ev.x), LE)
    dv.setUint16(o + 4, qPos(ev.y), LE)
    dv.setUint8(o + 6, (ev.playerId ?? 0) & 0xff)
    dv.setUint8(o + 7, (ev.by ?? 0) & 0xff)
    o += SIZES.EVENT
  }
  return buf
}

export function decodeSnapshot(buf) {
  if (!(buf instanceof ArrayBuffer)) throw new CodecError('expected ArrayBuffer')
  if (buf.byteLength < SIZES.HEADER) throw new CodecError('too short')
  const dv = new DataView(buf)
  if (dv.getUint8(0) !== BinaryType.SNAPSHOT) throw new CodecError('not a snapshot')
  if (dv.getUint8(1) !== PROTOCOL_VERSION) throw new CodecError(`version ${dv.getUint8(1)}`)
  const tick = dv.getUint32(2, LE)
  const ack = dv.getUint32(6, LE)
  const count = dv.getUint16(10, LE)
  const nEvents = dv.getUint8(12)
  let o = SIZES.HEADER
  const need = (n) => {
    if (o + n > buf.byteLength) throw new CodecError('truncated')
  }
  const entities = []
  for (let i = 0; i < count; i++) {
    need(3)
    const kind = KIND_NAME[dv.getUint8(o)]
    if (!kind) throw new CodecError(`bad kind ${dv.getUint8(o)}`)
    const id = dv.getUint16(o + 1, LE)
    need(SIZES[kind])
    o += 3
    switch (kind) {
      case 'ship':
        entities.push({
          kind,
          id,
          playerId: dv.getUint8(o),
          x: dv.getUint16(o + 1, LE) / POS,
          y: dv.getUint16(o + 3, LE) / POS,
          vx: dv.getInt16(o + 5, LE) / VEL,
          vy: dv.getInt16(o + 7, LE) / VEL,
          angle: (dv.getUint16(o + 9, LE) / 65536) * TAU,
          hp: dv.getUint8(o + 11),
          flags: dv.getUint8(o + 12),
          score: dv.getUint16(o + 13, LE),
        })
        o += 15
        break
      case 'bullet':
        entities.push({
          kind,
          id,
          owner: dv.getUint8(o),
          seq: dv.getUint16(o + 1, LE),
          x: dv.getUint16(o + 3, LE) / POS,
          y: dv.getUint16(o + 5, LE) / POS,
          vx: dv.getInt16(o + 7, LE) / VEL,
          vy: dv.getInt16(o + 9, LE) / VEL,
          homing: dv.getUint8(o + 11) === 1,
        })
        o += 12
        break
      case 'asteroid':
        entities.push({
          kind,
          id,
          x: dv.getUint16(o, LE) / POS,
          y: dv.getUint16(o + 2, LE) / POS,
          angle: (dv.getUint16(o + 4, LE) / 65536) * TAU,
          radius: dv.getUint8(o + 6),
          homing: dv.getUint8(o + 7) === 1,
        })
        o += 8
        break
      case 'pickup': {
        const effect = EFFECTS[dv.getUint8(o + 4)]
        if (!effect) throw new CodecError('bad effect')
        entities.push({ kind, id, x: dv.getUint16(o, LE) / POS, y: dv.getUint16(o + 2, LE) / POS, effect })
        o += 5
        break
      }
    }
  }
  const events = []
  for (let i = 0; i < nEvents; i++) {
    need(SIZES.EVENT)
    const type = EVENT_NAME[dv.getUint8(o)]
    if (!type) throw new CodecError('bad event')
    const sub = dv.getUint8(o + 1)
    events.push({
      type,
      kind: type === 'pickup' ? '' : (KIND_NAME[sub] ?? ''),
      effect: type === 'pickup' ? (EFFECTS[sub] ?? '') : '',
      x: dv.getUint16(o + 2, LE) / POS,
      y: dv.getUint16(o + 4, LE) / POS,
      playerId: dv.getUint8(o + 6),
      by: dv.getUint8(o + 7),
    })
    o += SIZES.EVENT
  }
  if (o !== buf.byteLength) throw new CodecError('trailing bytes')
  return { tick, ack, entities, events }
}

export function encodeInput({ seq, bits }) {
  const buf = new ArrayBuffer(SIZES.INPUT)
  const dv = new DataView(buf)
  dv.setUint8(0, BinaryType.INPUT)
  dv.setUint32(1, seq >>> 0, LE)
  dv.setUint8(5, bits & 0x0f)
  return buf
}

export function decodeInput(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength !== SIZES.INPUT) throw new CodecError('bad input length')
  const dv = new DataView(buf)
  if (dv.getUint8(0) !== BinaryType.INPUT) throw new CodecError('not an input')
  const bits = dv.getUint8(5)
  if (bits > 15) throw new CodecError('bad buttons')
  return { seq: dv.getUint32(1, LE), bits }
}

export const binaryCodec = { name: 'binary', encodeSnapshot, decodeSnapshot, encodeInput, decodeInput }
