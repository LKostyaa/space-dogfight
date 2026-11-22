import type { Effect } from '@dogfight/shared/sim/pickup.ts'

export interface Point {
  x: number
  y: number
}

interface ViewBase {
  pos: Point
  prevPos: Point
  angle: number
  prevAngle: number
  homing: boolean
}

export interface ViewShip extends ViewBase {
  readonly kind: 'ship'
  radius: number
  name: string
  color: string
  hp: number
  dead: boolean
  shield: boolean
  thrust: boolean
}
export interface ViewBullet extends ViewBase {
  readonly kind: 'bullet'
  radius: number
}
export interface ViewAsteroid extends ViewBase {
  readonly kind: 'asteroid'
  radius: number
}
export interface ViewPickup extends ViewBase {
  readonly kind: 'pickup'
  effect: Effect
}

export interface ClientParticle {
  x: number
  y: number
  vx: number
  vy: number
}
export interface ViewExplosion extends ViewBase {
  readonly kind: 'explosion'
  color: string
  life: number
  readonly particles: ClientParticle[]
}

export type ViewEntity = ViewShip | ViewBullet | ViewAsteroid | ViewPickup | ViewExplosion

export function point(x = 0, y = 0): Point {
  return { x, y }
}
