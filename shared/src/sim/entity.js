import { Vector2 } from './vector.js'
import { wrapPos } from './arena.js'

/**
 * Base class for everything in the world. Ids come from a private static
 * counter, so nothing outside the class can forge or reset them.
 *
 * Shared behavior is NOT added through deeper subclasses but through
 * `behaviors` — small objects with an `update(entity, world, dt)` method
 * (composition, see README "Чому композиція").
 */
export class Entity {
  static #nextId = 1
  static resetIds(n = 1) {
    Entity.#nextId = n
  }

  constructor({ kind, pos = new Vector2(), vel = new Vector2(), angle = 0, radius = 10 }) {
    this.id = Entity.#nextId++
    this.kind = kind
    this.pos = pos
    this.vel = vel
    this.angle = angle
    this.radius = radius
    this.alive = true
    this.collidable = true
    this.behaviors = []
    // previous state for render interpolation
    this.prevPos = pos
    this.prevAngle = angle
  }

  /** Saved at the start of each step so the renderer can lerp(prev, current, alpha). */
  remember() {
    this.prevPos = this.pos
    this.prevAngle = this.angle
  }

  update(dt, world) {
    for (const b of this.behaviors) b.update(this, world, dt)
    this.pos = this.pos.add(this.vel.scale(dt))
    this.wrap()
  }

  wrap() {
    this.pos = wrapPos(this.pos)
  }

  /** Called by the collision system. Default: nothing happens. */
  onCollide(_other, _world) {}
}
