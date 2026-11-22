import { Entity } from './entity.ts'
import type { Vector2 } from './vector.ts'
import type { AnyEntity } from './kinds.ts'
import type { World } from './world.ts'
import type { Ship } from './ship.ts'

export const EFFECTS = {
  shield: (ship: Ship) => (ship.shield = 6),
  rapid: (ship: Ship) => (ship.rapidFire = 6),
  homing: (ship: Ship) => (ship.homing = 6),
} as const satisfies Record<string, (ship: Ship) => void>

export type Effect = keyof typeof EFFECTS
export const EFFECT_NAMES: readonly Effect[] = ['shield', 'rapid', 'homing']

export class Pickup extends Entity {
  readonly kind = 'pickup'
  readonly effect: Effect

  constructor({ pos, effect }: { pos: Vector2; effect: Effect }) {
    super({ pos, radius: 12 })
    this.effect = effect
  }

  override update(dt: number, world: World): void {
    super.update(dt, world)
    this.angle += dt
  }

  override onCollide(other: AnyEntity, world: World): void {
    if (other.kind !== 'ship' || other.dead) return
    EFFECTS[this.effect](other)
    world.despawn(this.id)
    world.emit('pickup', { playerId: other.playerId, effect: this.effect, x: this.pos.x, y: this.pos.y })
  }
}
