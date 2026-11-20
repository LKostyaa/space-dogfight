import { Entity } from './entity.js'

export const BULLET_TTL = 1.1
export const BULLET_DAMAGE = 25

export class Bullet extends Entity {
  constructor({ pos, vel, owner }) {
    super({ kind: 'bullet', pos, vel, angle: Math.atan2(vel.y, vel.x), radius: 3 })
    this.owner = owner
    this.ttl = BULLET_TTL
  }

  update(dt, world) {
    super.update(dt, world)
    this.ttl -= dt
    if (this.ttl <= 0) world.despawn(this.id)
  }

  onCollide(other, world) {
    if (other === this.owner || other.kind === 'bullet' || other.kind === 'pickup') return
    if (other.kind === 'ship') other.damage(BULLET_DAMAGE, world, this.owner)
    if (other.kind === 'asteroid') other.damage(BULLET_DAMAGE, world, this.owner)
    world.despawn(this.id)
  }
}
