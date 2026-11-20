import type { Effect } from '@dogfight/shared/sim/pickup.ts'

/** Mutable 2D point. View objects are reused frame to frame (Lab 7: no per-frame allocations). */
export interface Point {
  x: number
  y: number
}

/**
 * What the renderer draws. Built by NetGame from snapshots (interpolated) or
 * from local prediction — the renderer does not care which. These objects are
 * pooled and mutated in place every frame, so the render loop allocates nothing.
 */
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

/** A point whose prevPos IS pos: interpolation already happened in NetGame. */
export function point(x = 0, y = 0): Point {
  return { x, y }
}
