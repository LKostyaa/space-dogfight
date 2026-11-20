import { Entity } from './entity.js'
import { Vector2 } from './vector.js'

/** Short-lived particles. Many small objects -> remember this for Lab 7 (GC). */
export class Explosion extends Entity {
  constructor({ pos, rng, color = '#ffb347', count = 18 }) {
    super({ kind: 'explosion', pos, radius: 0 })
    this.collidable = false
    this.color = color
    this.life = 0.7
    this.particles = Array.from({ length: count }, () => ({
      offset: new Vector2(),
      vel: Vector2.fromAngle(rng.range(0, Math.PI * 2), rng.range(40, 220)),
    }))
  }

  update(dt, world) {
    this.life -= dt
    for (const p of this.particles) p.offset = p.offset.add(p.vel.scale(dt))
    if (this.life <= 0) world.despawn(this.id)
  }
}
