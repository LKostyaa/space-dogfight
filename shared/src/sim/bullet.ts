import { Entity } from './entity.ts'
import type { Vector2 } from './vector.ts'
import type { AnyEntity } from './kinds.ts'
import type { World } from './world.ts'
import type { Ship } from './ship.ts'

export const BULLET_TTL = 1.1
export const BULLET_DAMAGE = 25

export class Bullet extends Entity {
  readonly kind = 'bullet'
  ttl = BULLET_TTL
  /** seq of the input that fired it — lets the client match its predicted bullet. */
  seq = 0

  constructor({ pos, vel, owner }: { pos: Vector2; vel: Vector2; owner: Ship }) {
    super({ pos, vel, angle: Math.atan2(vel.y, vel.x), radius: 3 })
    this.owner = owner
  }

  override update(dt: number, world: World): void {
    super.update(dt, world)
    this.ttl -= dt
    if (this.ttl <= 0) world.despawn(this.id)
  }

  override onCollide(other: AnyEntity, world: World): void {
    if (other === this.owner || other.kind === 'bullet' || other.kind === 'pickup' || other.kind === 'explosion') return
    other.damage(BULLET_DAMAGE, world, this.owner)
    world.despawn(this.id)
  }
}
