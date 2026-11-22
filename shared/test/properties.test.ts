import { describe, it } from 'vitest'
import fc from 'fast-check'
import { binaryCodec, CodecError } from '../src/codec/index.ts'
import { snapshotSize } from '../src/codec/binary.ts'
import { SnapshotSchema, parseClientMessage, type EntitySnap } from '../src/protocol.ts'
import { stepShipState, type ShipState } from '../src/sim/ship.ts'
import { ARENA } from '../src/sim/arena.ts'
import { DT } from '../src/sim/constants.ts'
import { v } from './helpers.ts'

const x = fc.double({ min: 0, max: ARENA.width - 0.01, noNaN: true })
const y = fc.double({ min: 0, max: ARENA.height - 0.01, noNaN: true })
const vel = fc.double({ min: -1000, max: 1000, noNaN: true })
const ang = fc.double({ min: -20, max: 20, noNaN: true })
const id = fc.integer({ min: 0, max: 0xffff })
const pid = fc.integer({ min: 0, max: 255 })

const ship = fc.record({ kind: fc.constantFrom('ship' as const), id, playerId: pid, x, y, vx: vel, vy: vel, angle: ang, hp: fc.integer({ min: 0, max: 100 }), score: fc.integer({ min: 0, max: 60000 }), flags: fc.integer({ min: 0, max: 31 }) })
const bullet = fc.record({ kind: fc.constantFrom('bullet' as const), id, owner: pid, seq: fc.integer({ min: 0, max: 0xffff }), x, y, vx: vel, vy: vel, homing: fc.boolean() })
const asteroid = fc.record({ kind: fc.constantFrom('asteroid' as const), id, x, y, angle: ang, radius: fc.integer({ min: 5, max: 60 }), homing: fc.boolean() })
const pickup = fc.record({ kind: fc.constantFrom('pickup' as const), id, x, y, effect: fc.constantFrom('shield' as const, 'rapid' as const, 'homing' as const) })
const snapshot = fc
  .record({ tick: fc.integer({ min: 0, max: 2 ** 31 }), ack: fc.integer({ min: 0, max: 2 ** 31 }), entities: fc.array(fc.oneof(ship, bullet, asteroid, pickup), { maxLength: 40 }) })
  .map((r) => SnapshotSchema.parse({ ...r, events: [] }))

const close = (a: EntitySnap, b: EntitySnap): boolean => Math.abs(a.x - b.x) <= 0.0125 && Math.abs(a.y - b.y) <= 0.0125 && a.kind === b.kind && a.id === b.id

describe('properties (fast-check)', () => {
  it('codec round trip stays within quantization tolerance', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const d = binaryCodec.decodeSnapshot(binaryCodec.encodeSnapshot(s))
        return d.tick === s.tick && d.ack === s.ack && d.entities.length === s.entities.length && d.entities.every((e, i) => { const o = s.entities[i]; return o !== undefined && close(e, o) })
      }),
      { numRuns: 200 },
    )
  })

  it('encoded length always equals the spec formula', () => {
    fc.assert(
      fc.property(snapshot, (s) => {
        const buf = binaryCodec.encodeSnapshot(s)
        return typeof buf !== 'string' && buf.byteLength === snapshotSize(s)
      }),
      { numRuns: 200 },
    )
  })

  it('arbitrary garbage -> CodecError, never a crash of another kind', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const buf = new ArrayBuffer(bytes.length)
        new Uint8Array(buf).set(bytes)
        try {
          binaryCodec.decodeSnapshot(buf)
          return true // a valid snapshot by chance is fine
        } catch (e: unknown) {
          return e instanceof CodecError
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('a ship stays inside the arena over 1000 random input steps', () => {
    const controls = fc.record({ left: fc.boolean(), right: fc.boolean(), thrust: fc.boolean(), fire: fc.boolean() })
    fc.assert(
      fc.property(fc.array(controls, { minLength: 1000, maxLength: 1000 }), x, y, (inputs, x0, y0) => {
        let s: ShipState = { pos: v(x0, y0), vel: v(0, 0), angle: 0 }
        for (const c of inputs) {
          s = stepShipState(s, c, DT)
          if (s.pos.x < 0 || s.pos.x >= ARENA.width || s.pos.y < 0 || s.pos.y >= ARENA.height) return false
        }
        return true
      }),
      { numRuns: 30 },
    )
  })

  it('parseClientMessage accepts every generated valid message and rejects every mutation', () => {
    const valid = fc.oneof(
      fc.record({ v: fc.constantFrom(1), type: fc.constantFrom('chat'), text: fc.string({ minLength: 1, maxLength: 200 }) }),
      fc.record({ v: fc.constantFrom(1), type: fc.constantFrom('input'), seq: fc.integer({ min: 0, max: 2 ** 32 - 1 }), b: fc.integer({ min: 0, max: 15 }) }),
      fc.record({ v: fc.constantFrom(1), type: fc.constantFrom('ping'), t: fc.double({ min: 0, max: 1e9, noNaN: true }) }),
    )
    const mutate = fc.constantFrom<(m: Record<string, unknown>) => Record<string, unknown>>(
      (m) => ({ ...m, v: 0 }),
      (m) => ({ ...m, type: 'hack' }),
      (m) => ({ ...m, b: 99, text: '', t: 'x', seq: -1 }),
      ({ type: _t, ...rest }) => rest,
    )
    fc.assert(fc.property(valid, mutate, (m, f) => parseClientMessage(m).ok && !parseClientMessage(f(m)).ok), { numRuns: 300 })
  })
})
