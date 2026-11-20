import { test } from 'node:test'
import assert from 'node:assert/strict'
import { binaryCodec, jsonCodec, CodecError } from '../src/codec/index.js'
import { snapshotSize, SIZES } from '../src/codec/binary.js'

const snap = {
  tick: 1234,
  ack: 77,
  entities: [
    { kind: 'ship', id: 5, playerId: 2, x: 812.33, y: 77.1, vx: -120.5, vy: 33.25, angle: 1.2, hp: 75, score: 12, flags: 5 },
    { kind: 'bullet', id: 900, owner: 2, seq: 70, x: 10, y: 899, vx: 600, vy: -200, homing: true },
    { kind: 'asteroid', id: 7, x: 1599.9, y: 0, angle: 6.1, radius: 34, homing: false },
    { kind: 'pickup', id: 8, x: 400, y: 450, effect: 'rapid' },
  ],
  events: [{ type: 'exploded', kind: 'ship', effect: '', x: 100, y: 200, playerId: 2, by: 1 }, { type: 'pickup', kind: '', effect: 'homing', x: 1, y: 2, playerId: 1, by: 0 }],
}

const close = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`)

test('binary snapshot round-trips within quantization tolerance', () => {
  const out = binaryCodec.decodeSnapshot(binaryCodec.encodeSnapshot(snap))
  assert.equal(out.tick, 1234)
  assert.equal(out.ack, 77)
  assert.equal(out.entities.length, 4)
  snap.entities.forEach((e, i) => {
    const d = out.entities[i]
    assert.equal(d.kind, e.kind)
    assert.equal(d.id, e.id)
    close(d.x, e.x, 0.0125, 'x')
    close(d.y, e.y, 0.0125, 'y')
    if ('vx' in e) close(d.vx, e.vx, 1 / 32, 'vx')
    if ('angle' in e) close(Math.cos(d.angle), Math.cos(e.angle), 1e-4, 'angle')
  })
  assert.equal(out.entities[3].effect, 'rapid')
  assert.deepEqual(out.events.map((e) => [e.type, e.kind, e.effect, e.playerId, e.by]), [['exploded', 'ship', '', 2, 1], ['pickup', '', 'homing', 1, 0]])
})

test('binary length matches the spec', () => {
  assert.equal(binaryCodec.encodeSnapshot(snap).byteLength, SIZES.HEADER + 18 + 15 + 11 + 8 + 2 * SIZES.EVENT)
  assert.equal(snapshotSize(snap), binaryCodec.encodeSnapshot(snap).byteLength)
})

test('input round-trips in both codecs', () => {
  for (const c of [binaryCodec, jsonCodec]) assert.deepEqual(c.decodeInput(c.encodeInput({ seq: 123456, bits: 13 })), { seq: 123456, bits: 13 })
})

test('garbage and truncated buffers throw CodecError, never anything else', () => {
  const good = binaryCodec.encodeSnapshot(snap)
  for (let n = 0; n < good.byteLength; n++) assert.throws(() => binaryCodec.decodeSnapshot(good.slice(0, n)), CodecError)
  const bad = new Uint8Array(good.slice(0))
  bad[1] = 99
  assert.throws(() => binaryCodec.decodeSnapshot(bad.buffer), CodecError)
  assert.throws(() => binaryCodec.decodeInput(new ArrayBuffer(3)), CodecError)
  assert.throws(() => jsonCodec.decodeInput('{"v":1,"type":"input","seq":-1,"b":0}'), CodecError)
})
