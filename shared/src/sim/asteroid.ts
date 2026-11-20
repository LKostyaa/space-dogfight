import { Entity } from './entity.ts'
import { Explosion } from './explosion.ts'
import type { Vector2 } from './vector.ts'
import type { AnyEntity } from './kinds.ts'
import type { World } from './world.ts'
import type { Ship } from './ship.ts'

export class Asteroid extends Entity {
  readonly kind = 'asteroid'
  #hp: number
  spin: number

  constructor({ pos, vel, radius = 34, spin = 0.5 }: { pos: Vector2; vel: Vector2; radius?: number; spin?: number }) {
    super({ pos, vel, radius })
    this.spin = spin
    this.#hp = radius * 2
  }

  get hp(): number {
    return this.#hp
  }

  override update(dt: number, world: World): void {
    super.update(dt, world)
    this.angle += this.spin * dt
  }

  damage(amount: number, world: World, attacker: Ship | null): void {
    this.#hp -= amount
    if (this.#hp > 0) return
    world.despawn(this.id)
    world.spawn(new Explosion({ pos: this.pos, rng: world.rng, color: '#b8a58a' }))
    world.emit('exploded', { kind: 'asteroid', by: attacker?.playerId ?? 0, x: this.pos.x, y: this.pos.y })
    if (attacker) attacker.score += 1
    // a big rock splits into two smaller ones
    if (this.radius > 20) {
      for (const s of [-1, 1]) {
        world.spawn(
          new Asteroid({
            pos: this.pos,
            vel: this.vel.rotate(s * 0.7).scale(1.4),
            radius: this.radius * 0.6,
            spin: -this.spin * 1.5,
          }),
        )
      }
    }
  }

  override onCollide(other: AnyEntity): void {
    // asteroids bounce off each other
    if (other.kind !== 'asteroid') return
    const n = this.pos.sub(other.pos).normalize()
    if (this.vel.sub(other.vel).dot(n) < 0) this.vel = this.vel.sub(n.scale(2 * this.vel.dot(n)))
  }
}
