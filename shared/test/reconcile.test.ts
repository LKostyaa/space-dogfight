import { describe, it, expect } from 'vitest'
import { reconcile, type PendingInput } from '../src/net/reconcile.ts'
import { stepShipState, type ShipState } from '../src/sim/ship.ts'
import { DT } from '../src/sim/constants.ts'
import { controls, seq, v } from './helpers.ts'

const start: ShipState = { pos: v(100, 100), vel: v(0, 0), angle: 0 }
const inputs: PendingInput[] = [1, 2, 3, 4, 5].map((n) => ({ seq: seq(n), controls: controls({ right: n % 2 === 0, thrust: true }) }))
const run = (s: ShipState, list: readonly PendingInput[]) => list.reduce((acc, i) => stepShipState(acc, i.controls, DT), s)

describe('reconcile (pure function)', () => {
  it('drops acknowledged inputs and keeps the rest in order', () => {
    expect(reconcile(start, inputs, seq(2), DT).pending.map((p) => p.seq)).toEqual([3, 4, 5])
  })
  it('server state + replayed inputs == what the client predicted (deterministic sim)', () => {
    const r = reconcile(run(start, inputs.slice(0, 2)), inputs, seq(2), DT)
    const predicted = run(start, inputs)
    expect(r.state.pos.x).toBeCloseTo(predicted.pos.x, 9)
    expect(r.state.pos.y).toBeCloseTo(predicted.pos.y, 9)
  })
  it('a wrong server position is corrected, not ignored', () => {
    const server = { ...run(start, inputs.slice(0, 2)), pos: v(500, 500) }
    expect(reconcile(server, inputs, seq(2), DT).state.pos.x).toBeGreaterThan(400)
  })
  it('everything acknowledged -> the server state as is', () => {
    const r = reconcile(start, inputs, seq(5), DT)
    expect(r.pending).toEqual([])
    expect(r.state).toBe(start)
  })
})
