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
    // Event bus: the sim dispatches, audio/HUD/network subscribe. The sim imports none of them.
    this.bus = new EventTarget()
    // the same events, collected per step, so the server can put them into snapshots
    this.stepEvents = []
    this.targets = { asteroids: 0, pickups: 0 }
    this.maintenanceIn = 0
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

  emit(type, detail) {
    this.stepEvents.push({ type, ...detail })
    this.bus.dispatchEvent(new CustomEvent(type, { detail }))
  }

  /** Returns and clears the events of the steps since the last call. */
  drainEvents() {
    const events = this.stepEvents
    this.stepEvents = []
    return events
  }

  /** inputs: Map<playerId, controls> */
  step(dt, inputs = new Map()) {
    for (const e of this.#entities.values()) if (!e.driven) e.remember()
    for (const ship of this.ofKind('ship')) if (!ship.driven) ship.controls = inputs.get(ship.playerId) ?? ship.controls
    for (const e of this.#entities.values()) if (e.alive) e.update(dt, this)
    resolveCollisions(this, this.findPairs)
    this.sweep()
    this.time += dt
    this.maintenanceIn -= dt
    if (this.maintenanceIn <= 0) this.maintain()
  }

  /** Every few seconds: top up rocks and power-ups so a long match never runs empty. */
  maintain() {
    this.maintenanceIn = 5
    let rocks = 0
    for (const _ of this.ofKind('asteroid')) rocks++
    if (rocks < this.targets.asteroids) {
      const edge = this.rng.int(2) === 0 ? new Vector2(0, this.rng.range(0, ARENA.height)) : new Vector2(this.rng.range(0, ARENA.width), 0)
      this.spawn(new Asteroid({ pos: edge, vel: Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60)), radius: this.rng.range(26, 40), spin: this.rng.range(-1, 1) }))
    }
    let pickups = 0
    for (const _ of this.ofKind('pickup')) pickups++
    if (pickups < this.targets.pickups) {
      const effects = ['shield', 'rapid', 'homing']
      this.spawn(new Pickup({ pos: this.findSafeSpot(), effect: effects[this.rng.int(effects.length)] }))
    }
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
    this.targets = { asteroids, pickups }
    this.maintenanceIn = 5
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
