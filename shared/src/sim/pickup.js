import { Entity } from './entity.js'

/**
 * Stationary, collidable, but not a ship. The effect is data, not a subclass:
 * adding a new pickup type is one entry in EFFECTS.
 */
export const EFFECTS = {
  shield: (ship) => (ship.shield = 6),
  rapid: (ship) => (ship.rapidFire = 6),
  homing: (ship) => (ship.homing = 6),
}

export class Pickup extends Entity {
  constructor({ pos, effect }) {
    super({ kind: 'pickup', pos, radius: 12 })
    this.effect = effect
  }

  update(dt, world) {
    super.update(dt, world)
    this.angle += dt
  }

  onCollide(other, world) {
    if (other.kind !== 'ship' || other.dead) return
    EFFECTS[this.effect](other)
    world.despawn(this.id)
    world.emit('pickup', { id: other.id, playerId: other.playerId, effect: this.effect, x: this.pos.x, y: this.pos.y })
  }
}
