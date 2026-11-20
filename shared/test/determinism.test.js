import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { World } from '../src/sim/world.js'
import { Ship } from '../src/sim/ship.js'
import { Entity } from '../src/sim/entity.js'
import { Vector2 } from '../src/sim/vector.js'
import { DT } from '../src/sim/constants.js'
import { createRng } from '../src/sim/rng.js'
import { worldToSnapshot } from '../src/net/snapshot.js'

function run(seed, steps) {
  Entity.resetIds()
  const w = new World({ seed })
  w.populate({ asteroids: 6, pickups: 3 })
  w.spawn(new Ship({ pos: new Vector2(300, 300), playerId: 1 }))
  w.spawn(new Ship({ pos: new Vector2(1200, 600), playerId: 2 }))
  const inputs = createRng(99) // scripted "players"
  for (let i = 0; i < steps; i++) {
    const c = () => ({ left: inputs.next() < 0.3, right: inputs.next() < 0.3, thrust: inputs.next() < 0.6, fire: inputs.next() < 0.2 })
    w.step(DT, new Map([[1, c()], [2, c()]]))
  }
  return createHash('sha256').update(JSON.stringify(worldToSnapshot(w, steps))).digest('hex')
}

test('the shared sim imports and runs in Node (no DOM)', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.ok(run(1, 10))
})

test('same seed + same inputs -> same world hash', () => {
  assert.equal(run(7, 900), run(7, 900))
})

test('different seed -> different world', () => {
  assert.notEqual(run(7, 300), run(8, 300))
})
