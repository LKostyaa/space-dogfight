import { describe, it, expect } from 'vitest'
import { circlesOverlap, naivePairs, resolveCollisions } from '../src/sim/collision.ts'
import { spatialHashPairs } from '../src/sim/spatial-hash.ts'
import { World } from '../src/sim/world.ts'
import { Ship } from '../src/sim/ship.ts'
import { Bullet } from '../src/sim/bullet.ts'
import { Asteroid } from '../src/sim/asteroid.ts'
import { DT } from '../src/sim/constants.ts'
import { pid, v } from './helpers.ts'

const circle = (x: number, y: number, radius: number) => ({ pos: { x, y }, radius })

describe('collisions', () => {
  it('touching circles collide', () => expect(circlesOverlap(circle(0, 0, 5), circle(10, 0, 5))).toBe(true))
  it('overlapping circles collide', () => expect(circlesOverlap(circle(0, 0, 5), circle(3, 4, 5))).toBe(true))
  it('separated circles do not', () => expect(circlesOverlap(circle(0, 0, 5), circle(10.01, 0, 5))).toBe(false))

  it('a bullet damages a ship it hits, not its owner', () => {
    const w = new World({ seed: 1 })
    const shooter = w.spawn(new Ship({ pos: v(100, 100), playerId: pid(1) }))
    const target = w.spawn(new Ship({ pos: v(300, 100), playerId: pid(2) }))
    w.spawn(new Bullet({ pos: v(300, 100), vel: v(0, 0), owner: shooter }))
    resolveCollisions(w)
    expect(target.hp).toBeLessThan(100)
    expect(shooter.hp).toBe(100)
  })

  it('a fast bullet tunnels through a thin target between two steps (known limitation)', () => {
    // 620 px/s * 1/30 s = ~21 px per step; a radius-3 bullet can skip a radius-3 target.
    // Documented in the README; not worth swept collision at our speeds and sizes.
    const w = new World({ seed: 1 })
    const owner = w.spawn(new Ship({ pos: v(900, 800), playerId: pid(1) }))
    const thin = w.spawn(new Asteroid({ pos: v(110, 100), vel: v(0, 0), radius: 3, spin: 0 }))
    w.spawn(new Bullet({ pos: v(100, 100), vel: v(3000, 0), owner }))
    w.step(DT)
    expect(thin.hp).toBe(6) // untouched: radius 3 -> hp 6
  })

  it('the spatial hash finds exactly the same pairs as the naive O(n²) scan', () => {
    const w = new World({ seed: 3 })
    w.populate({ asteroids: 25, pickups: 6 })
    for (let i = 0; i < 8; i++) w.spawn(new Ship({ pos: w.findSafeSpot(), playerId: pid(i + 1) }))
    const key = (pairs: Iterable<readonly [{ id: number }, { id: number }]>) =>
      [...pairs].map(([a, b]) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`)).sort()
    for (let i = 0; i < 120; i++) {
      w.step(DT)
      expect(key(spatialHashPairs()([...w]))).toEqual(key(naivePairs([...w])))
    }
  })
})
