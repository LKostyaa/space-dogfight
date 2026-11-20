import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { World } from '../src/sim/world.ts'
import { Ship, type Controls } from '../src/sim/ship.ts'
import { Entity } from '../src/sim/entity.ts'
import { DT } from '../src/sim/constants.ts'
import { createRng } from '../src/sim/rng.ts'
import { worldToSnapshot } from '../src/net/snapshot.ts'
import { pid, v } from './helpers.ts'

function run(seed: number, steps: number): string {
  Entity.resetIds()
  const w = new World({ seed })
  w.populate({ asteroids: 6, pickups: 3 })
  w.spawn(new Ship({ pos: v(300, 300), playerId: pid(1) }))
  w.spawn(new Ship({ pos: v(1200, 600), playerId: pid(2) }))
  const inputs = createRng(99) // scripted "players"
  const c = (): Controls => ({ left: inputs.next() < 0.3, right: inputs.next() < 0.3, thrust: inputs.next() < 0.6, fire: inputs.next() < 0.2 })
  for (let i = 0; i < steps; i++) w.step(DT, new Map([[pid(1), c()], [pid(2), c()]]))
  return createHash('sha256').update(JSON.stringify(worldToSnapshot(w, steps))).digest('hex')
}

describe('determinism', () => {
  it('the shared sim imports and runs in Node (no DOM)', () => {
    expect(typeof globalThis.document).toBe('undefined')
    expect(run(1, 10)).toHaveLength(64)
  })
  it('same seed + same inputs -> same world hash', () => expect(run(7, 900)).toBe(run(7, 900)))
  it('different seed -> different world', () => expect(run(7, 300)).not.toBe(run(8, 300)))
  it('seeded rng: same seed, same sequence', () => {
    const a = createRng(5)
    const b = createRng(5)
    expect([a.next(), a.int(10), a.range(1, 2)]).toEqual([b.next(), b.int(10), b.range(1, 2)])
  })
})
