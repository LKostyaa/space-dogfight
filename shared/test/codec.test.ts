import { describe, it, expect } from 'vitest'
import { binaryCodec, jsonCodec, CodecError } from '../src/codec/index.ts'
import { snapshotSize, SIZES } from '../src/codec/binary.ts'
import { SnapshotSchema, type Snapshot } from '../src/protocol.ts'
import { seq } from './helpers.ts'

export const sample: Snapshot = SnapshotSchema.parse({
  tick: 1234,
  ack: 77,
  entities: [
    { kind: 'ship', id: 5, playerId: 2, x: 812.33, y: 77.1, vx: -120.5, vy: 33.25, angle: 1.2, hp: 75, score: 12, flags: 5 },
    { kind: 'bullet', id: 900, owner: 2, seq: 70, x: 10, y: 899, vx: 600, vy: -200, homing: true },
    { kind: 'asteroid', id: 7, x: 1599.9, y: 0, angle: 6.1, radius: 34, homing: false },
    { kind: 'pickup', id: 8, x: 400, y: 450, effect: 'rapid' },
  ],
  events: [
    { type: 'exploded', kind: 'ship', effect: '', x: 100, y: 200, playerId: 2, by: 1 },
    { type: 'pickup', kind: '', effect: 'homing', x: 1, y: 2, playerId: 1, by: 0 },
  ],
})

const bytes = (w: string | ArrayBuffer): ArrayBuffer => {
  if (typeof w === 'string') throw new Error('expected binary')
  return w
}

describe('binary codec', () => {
  it('header fields survive the round trip', () => {
    const out = binaryCodec.decodeSnapshot(binaryCodec.encodeSnapshot(sample))
    expect(out.tick).toBe(1234)
    expect(out.ack).toBe(77)
    expect(out.entities.map((e) => e.kind)).toEqual(['ship', 'bullet', 'asteroid', 'pickup'])
  })
  it('events survive the round trip', () => {
    const out = binaryCodec.decodeSnapshot(binaryCodec.encodeSnapshot(sample))
    expect(out.events.map((e) => [e.type, e.kind, e.effect, e.playerId, e.by])).toEqual([
      ['exploded', 'ship', '', 2, 1],
      ['pickup', '', 'homing', 1, 0],
    ])
  })
  it('length matches the spec (docs/protocol.md)', () => {
    expect(bytes(binaryCodec.encodeSnapshot(sample)).byteLength).toBe(SIZES.HEADER + 18 + 15 + 11 + 8 + 2 * SIZES.EVENT)
    expect(snapshotSize(sample)).toBe(bytes(binaryCodec.encodeSnapshot(sample)).byteLength)
  })
  it('prepareSnapshot patches only the ack', () => {
    const make = binaryCodec.prepareSnapshot(sample)
    const a = binaryCodec.decodeSnapshot(make(seq(1)))
    const b = binaryCodec.decodeSnapshot(make(seq(99)))
    expect([a.ack, b.ack]).toEqual([1, 99])
    expect(a.entities).toEqual(b.entities)
  })
  it('every truncated prefix of a valid buffer is a CodecError', () => {
    const good = bytes(binaryCodec.encodeSnapshot(sample))
    for (let n = 0; n < good.byteLength; n++) expect(() => binaryCodec.decodeSnapshot(good.slice(0, n))).toThrow(CodecError)
  })
  it('wrong version and trailing bytes are rejected', () => {
    const bad = new Uint8Array(bytes(binaryCodec.encodeSnapshot(sample)).slice(0))
    bad[1] = 99
    expect(() => binaryCodec.decodeSnapshot(bad.buffer)).toThrow(CodecError)
    const long = new Uint8Array(bytes(binaryCodec.encodeSnapshot(sample)).byteLength + 1)
    long.set(new Uint8Array(bytes(binaryCodec.encodeSnapshot(sample))))
    expect(() => binaryCodec.decodeSnapshot(long.buffer)).toThrow('trailing')
  })
  it('input: 6 bytes, round trip, bad length rejected', () => {
    const buf = bytes(binaryCodec.encodeInput({ seq: seq(123456), bits: 13 }))
    expect(buf.byteLength).toBe(6)
    expect(binaryCodec.decodeInput(buf)).toEqual({ seq: 123456, bits: 13 })
    expect(() => binaryCodec.decodeInput(new ArrayBuffer(3))).toThrow(CodecError)
  })
})

describe('json codec', () => {
  it('snapshot round-trips exactly', () => expect(jsonCodec.decodeSnapshot(jsonCodec.encodeSnapshot(sample))).toEqual(sample))
  it('prepareSnapshot output is a valid snapshot with the patched ack', () => {
    const out = jsonCodec.decodeSnapshot(jsonCodec.prepareSnapshot(sample)(seq(5)))
    expect(out.ack).toBe(5)
    expect(out.entities).toEqual(sample.entities)
  })
  it('rejects a negative seq and non-JSON', () => {
    expect(() => jsonCodec.decodeInput('{"v":1,"type":"input","seq":-1,"b":0}')).toThrow(CodecError)
    expect(() => jsonCodec.decodeSnapshot('{nope')).toThrow(CodecError)
  })
})
