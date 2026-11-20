import { ARENA } from './arena.js'
import { Vector2 } from './vector.js'
import { createRng } from './rng.js'
import { resolveCollisions, naivePairs } from './collision.js'
import { Asteroid } from './asteroid.js'
import { Pickup } from './pickup.js'
import { homing } from './behaviors.js'

export class World {
  #entities = new Map()
  #dead = new Set()

  constructor({ seed = 1, findPairs = naivePairs } = {}) {
    this.rng = createRng(seed)
    this.findPairs = findPairs
    this.time = 0
    this.listeners = []
  }

  spawn(e) {
    this.#entities.set(e.id, e)
    return e
  }

  /** Deferred: mark now, remove in sweep() at the end of the step. */
  despawn(id) {
    const e = this.#entities.get(id)
    if (e) e.alive = false
    this.#dead.add(id)
  }

  get(id) {
    return this.#entities.get(id)
  }

  get size() {
    return this.#entities.size
  }

  [Symbol.iterator]() {
    return this.#entities.values()
  }

  *ofKind(kind) {
    for (const e of this.#entities.values()) if (e.kind === kind && e.alive) yield e
  }

  /** Lab 2: a simple callback list. Lab 3 replaces it with an EventTarget bus. */
  emit(type, detail) {
    for (const fn of this.listeners) fn(type, detail)
  }

  /** inputs: Map<playerId, controls> */
  step(dt, inputs = new Map()) {
    for (const e of this.#entities.values()) e.remember()
    for (const ship of this.ofKind('ship')) ship.controls = inputs.get(ship.playerId) ?? ship.controls
    for (const e of this.#entities.values()) if (e.alive) e.update(dt, this)
    resolveCollisions(this, this.findPairs)
    this.sweep()
    this.time += dt
  }

  sweep() {
    for (const id of this.#dead) this.#entities.delete(id)
    this.#dead.clear()
  }

  findSafeSpot() {
    for (let tries = 0; tries < 30; tries++) {
      const p = new Vector2(this.rng.range(60, ARENA.width - 60), this.rng.range(60, ARENA.height - 60))
      let ok = true
      for (const e of this) if (e.collidable && e.kind !== 'bullet' && e.pos.sub(p).length() < e.radius + 120) ok = false
      if (ok) return p
    }
    return new Vector2(ARENA.width / 2, ARENA.height / 2)
  }

  /** Populate the arena with rocks and power-ups. */
  populate({ asteroids = 6, pickups = 3 } = {}) {
    for (let i = 0; i < asteroids; i++) {
      this.spawn(
        new Asteroid({
          pos: this.findSafeSpot(),
          vel: Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60)),
          radius: this.rng.range(22, 40),
          spin: this.rng.range(-1, 1),
        }),
      )
    }
    // one "hunter" rock: the same homing behavior as homing bullets
    const hunter = this.spawn(
      new Asteroid({ pos: this.findSafeSpot(), vel: new Vector2(40, 0), radius: 18, spin: 2 }),
    )
    hunter.behaviors.push(homing({ turnRate: 0.6, range: 600 }))
    const effects = ['shield', 'rapid', 'homing']
    for (let i = 0; i < pickups; i++) {
      this.spawn(new Pickup({ pos: this.findSafeSpot(), effect: effects[i % effects.length] }))
    }
  }
}
