import type { Vector2 } from '@dogfight/shared/sim/vector.ts'
import type { Effect } from '@dogfight/shared/sim/pickup.ts'
import type { Particle } from '@dogfight/shared/sim/explosion.ts'

/**
 * What the renderer draws. Built by NetGame from snapshots (interpolated) or
 * from local prediction — the renderer does not care which.
 */
interface ViewBase {
  readonly pos: Vector2
  readonly prevPos: Vector2
  readonly angle: number
  readonly prevAngle: number
  readonly homing: boolean
}

export interface ViewShip extends ViewBase {
  readonly kind: 'ship'
  readonly radius: number
  readonly name: string
  readonly color: string
  readonly hp: number
  readonly dead: boolean
  readonly shield: boolean
  readonly thrust: boolean
}
export interface ViewBullet extends ViewBase {
  readonly kind: 'bullet'
  readonly radius: number
}
export interface ViewAsteroid extends ViewBase {
  readonly kind: 'asteroid'
  readonly radius: number
}
export interface ViewPickup extends ViewBase {
  readonly kind: 'pickup'
  readonly effect: Effect
}
export interface ViewExplosion extends ViewBase {
  readonly kind: 'explosion'
  readonly color: string
  life: number
  readonly particles: Particle[]
}

export type ViewEntity = ViewShip | ViewBullet | ViewAsteroid | ViewPickup | ViewExplosion
