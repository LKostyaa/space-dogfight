import { describe, it, expect } from 'vitest'
import { parseClientMessage, parseServerMessage, controlsToBits, bitsToControls, encodeServerMessage } from '../src/protocol.ts'
import { ok, err } from '../src/types.ts'
import { controls } from './helpers.ts'

describe('protocol (zod)', () => {
  it('accepts a valid join', () => {
    const r = parseClientMessage(JSON.stringify({ v: 1, type: 'join', room: 'alpha', name: 'Kostya', codec: 'binary' }))
    expect(r.ok).toBe(true)
  })
  it('rejects garbage, unknown types, wrong version and bad fields — without throwing', () => {
    for (const raw of ['{nope', '[]', 'null', '{"v":1,"type":"hack"}', '{"v":9,"type":"chat","text":"x"}', '{"v":1,"type":"chat","text":""}', '{"v":1,"type":"join","room":"../x","name":"a"}']) {
      expect(parseClientMessage(raw).ok).toBe(false)
    }
  })
  it('accepts an already-parsed object too', () => {
    expect(parseClientMessage({ v: 1, type: 'ping', t: 5 }).ok).toBe(true)
  })
  it('input buttons are 0..15', () => {
    expect(parseClientMessage({ v: 1, type: 'input', seq: 1, b: 15 }).ok).toBe(true)
    expect(parseClientMessage({ v: 1, type: 'input', seq: 1, b: 16 }).ok).toBe(false)
  })
  it('server messages: encode -> parse', () => {
    const r = parseServerMessage(JSON.parse(encodeServerMessage({ v: 1, type: 'pong', t: 42 })))
    expect(r.ok && r.value.type === 'pong' && r.value.t).toBe(42)
    expect(parseServerMessage({ v: 1, type: 'nope' }).ok).toBe(false)
  })
  it('controls <-> bits round trip for all 16 combinations', () => {
    for (let b = 0; b < 16; b++) expect(controlsToBits(bitsToControls(b))).toBe(b)
    expect(controlsToBits(controls({ thrust: true, fire: true }))).toBe(12)
  })
  it('Result helpers', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 })
    expect(err('x')).toEqual({ ok: false, error: 'x' })
  })
})
