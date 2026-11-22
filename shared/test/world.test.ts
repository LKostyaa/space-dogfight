import { describe, it, expect } from 'vitest'
import { World } from '../src/sim/world.ts'
import { Ship } from '../src/sim/ship.ts'
import { Bullet } from '../src/sim/bullet.ts'
import { Entity } from '../src/sim/entity.ts'
import { DT } from '../src/sim/constants.ts'
import { worldToSnapshot } from '../src/net/snapshot.ts'
import { controls, pid, v } from './helpers.ts'

describe('World', () => {
  it('spawn / get / size / iteration', () => {
    const w = new World()
    const s = w.spawn(new Ship({ pos: v(1, 1), playerId: pid(1) }))
    expect(w.get(s.id)).toBe(s)
    expect(w.size).toBe(1)
    expect([...w]).toEqual([s])
  })
  it('ofKind is a generator of the right type', () => {
    const w = new World()
    w.populate({ asteroids: 3, pickups: 2 })
    expect([...w.ofKind('pickup')]).toHaveLength(2)
    expect([...w.ofKind('asteroid')].every((a) => a.kind === 'asteroid')).toBe(true)
  })
  it('despawn is deferred until the end of the step', () => {
    const w = new World()
    const s = w.spawn(new Ship({ pos: v(1, 1), playerId: pid(1) }))
    w.despawn(s.id)
    expect(w.get(s.id)).toBe(s)
    expect(s.alive).toBe(false)
    w.sweep()
    expect(w.get(s.id)).toBeUndefined()
  })
  it('bullets expire after their TTL', () => {
    const w = new World()
    const owner = w.spawn(new Ship({ pos: v(800, 800), playerId: pid(1) }))
    w.spawn(new Bullet({ pos: v(10, 10), vel: v(1, 0), owner }))
    for (let i = 0; i < 40; i++) w.step(DT)
    expect([...w.ofKind('bullet')]).toHaveLength(0)
  })
  it('emits events on the bus and collects them for snapshots', () => {
    const w = new World()
    const s = w.spawn(new Ship({ pos: v(500, 500), playerId: pid(1) }))
    let fired = 0
    w.bus.on('fired', () => fired++)
    w.step(DT, new Map([[s.playerId, controls({ fire: true })]]))
    expect(fired).toBe(1)
    expect(w.drainEvents().map((e) => e.type)).toEqual(['fired'])
    expect(w.drainEvents()).toEqual([])
  })
  it('stepping two identical worlds keeps them identical (determinism)', () => {
    const make = () => {
      Entity.resetIds()
      const w = new World({ seed: 9 })
      w.populate({ asteroids: 8, pickups: 3 })
      w.spawn(new Ship({ pos: v(300, 300), playerId: pid(1) }))
      return w
    }
    const run = () => {
      const w = make()
      for (let i = 0; i < 300; i++) w.step(DT, new Map([[pid(1), controls({ thrust: i % 3 !== 0, left: i % 50 < 10, fire: i % 7 === 0 })]]))
      return worldToSnapshot(w, 0)
    }
    expect(run()).toEqual(run())
  })
  it('maintain() tops rocks and pickups back up', () => {
    const w = new World({ seed: 2 })
    w.populate({ asteroids: 4, pickups: 2 })
    for (const p of w.ofKind('pickup')) w.despawn(p.id)
    w.sweep()
    w.maintain()
    expect([...w.ofKind('pickup')]).toHaveLength(1)
  })
})
