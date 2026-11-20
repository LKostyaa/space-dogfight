import { Entity } from './entity.ts'
import { Vector2 } from './vector.ts'
import type { Rng } from './rng.ts'
import type { World } from './world.ts'

export interface Particle {
  offset: Vector2
  vel: Vector2
}

/** Short-lived particles. Many small objects -> see Lab 7 (GC, pooling). */
export class Explosion extends Entity {
  readonly kind = 'explosion'
  color: string
  life = 0.7
  particles: Particle[]

  constructor({ pos, rng, color = '#ffb347', count = 18 }: { pos: Vector2; rng: Rng; color?: string; count?: number }) {
    super({ pos, radius: 0 })
    this.collidable = false
    this.color = color
    this.particles = Array.from({ length: count }, () => ({
      offset: new Vector2(),
      vel: Vector2.fromAngle(rng.range(0, Math.PI * 2), rng.range(40, 220)),
    }))
  }

  override update(dt: number, world: World): void {
    this.life -= dt
    for (const p of this.particles) p.offset = p.offset.add(p.vel.scale(dt))
    if (this.life <= 0) world.despawn(this.id)
  }
}
