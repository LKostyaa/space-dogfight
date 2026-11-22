import { Entity } from './entity.ts'
import { Vector2 } from './vector.ts'
import { Bullet } from './bullet.ts'
import { Explosion } from './explosion.ts'
import { homing } from './behaviors.ts'
import { wrapPos } from './arena.ts'
import type { AnyEntity } from './kinds.ts'
import type { World } from './world.ts'
import type { PlayerId, Seq } from '../types.ts'

export const TURN = 3.4
export const THRUST = 480
export const DRAG = 0.9
export const MAX_SPEED = 360
export const MAX_HP = 100
export const FIRE_COOLDOWN = 0.25
export const RESPAWN_TIME = 2
export const BULLET_SPEED = 620

export interface Controls {
  readonly left: boolean
  readonly right: boolean
  readonly thrust: boolean
  readonly fire: boolean
}

export const NO_CONTROLS: Controls = { left: false, right: false, thrust: false, fire: false }

/** The part of a ship that physics needs; also what the client predicts. */
export interface ShipState {
  readonly pos: Vector2
  readonly vel: Vector2
  readonly angle: number
}

/** Pure physics step: state + controls + dt -> new state. */
export function integrate(ship: ShipState, controls: Controls, dt: number): ShipState {
  let angle = ship.angle
  if (controls.left) angle -= TURN * dt
  if (controls.right) angle += TURN * dt
  let vel = ship.vel
  if (controls.thrust) vel = vel.add(Vector2.fromAngle(angle, THRUST * dt))
  vel = vel.scale(Math.exp(-DRAG * dt)).clampLength(MAX_SPEED)
  return { angle, vel, pos: ship.pos.add(vel.scale(dt)) }
}

export function stepShipState(state: ShipState, controls: Controls, dt: number): ShipState {
  const next = integrate(state, controls, dt)
  return { ...next, pos: wrapPos(next.pos) }
}

export interface ShipInit {
  pos: Vector2
  angle?: number
  playerId: PlayerId
  name?: string
  color?: string
}

export class Ship extends Entity {
  readonly kind = 'ship'
  #hp = MAX_HP
  readonly playerId: PlayerId
  name: string
  color: string
  score = 0
  controls: Controls = NO_CONTROLS
  cooldown = 0
  respawnIn = 0
  shield = 0 // seconds left
  rapidFire = 0 // seconds left
  homing = 0 // seconds left
  inputSeq = 0 // seq of the input being applied (bullets remember it for client prediction)

  constructor({ pos, angle = -Math.PI / 2, playerId, name = 'pilot', color = '#5ec8ff' }: ShipInit) {
    super({ pos, angle, radius: 14 })
    this.playerId = playerId
    this.name = name
    this.color = color
  }

  get hp(): number {
    return this.#hp
  }
  get dead(): boolean {
    return this.respawnIn > 0
  }

  override update(dt: number, world: World): void {
    if (this.dead) {
      this.respawnIn -= dt
      if (this.respawnIn <= 0) this.respawn(world)
      return
    }
    if (!this.driven) this.applyInput(this.controls, dt, world)
  }

  applyInput(controls: Controls, dt: number, world: World): void {
    if (this.dead) return
    this.controls = controls
    for (const b of this.behaviors) b.update(this, world, dt)
    const next = stepShipState(this, controls, dt)
    this.angle = next.angle
    this.vel = next.vel
    this.pos = next.pos

    this.cooldown = Math.max(0, this.cooldown - dt)
    this.shield = Math.max(0, this.shield - dt)
    this.rapidFire = Math.max(0, this.rapidFire - dt)
    this.homing = Math.max(0, this.homing - dt)
    if (controls.fire && this.cooldown === 0) this.fire(world)
  }

  fire(world: World): void {
    const nose = this.pos.add(Vector2.fromAngle(this.angle, this.radius + 4))
    const bullet = new Bullet({ pos: nose, vel: this.vel.add(Vector2.fromAngle(this.angle, BULLET_SPEED)), owner: this })
    bullet.seq = this.inputSeq
    if (this.homing > 0) bullet.behaviors.push(homing({ turnRate: 4 }))
    world.spawn(bullet)
    this.cooldown = this.rapidFire > 0 ? FIRE_COOLDOWN / 2.5 : FIRE_COOLDOWN
    world.emit('fired', { playerId: this.playerId, x: this.pos.x, y: this.pos.y })
  }

  damage(amount: number, world: World, attacker: Ship | null): void {
    if (this.dead || this.shield > 0) return
    this.#hp -= amount
    world.emit('hit', { kind: 'ship', playerId: this.playerId, x: this.pos.x, y: this.pos.y })
    if (this.#hp <= 0) {
      this.respawnIn = RESPAWN_TIME
      this.collidable = false
      if (attacker && attacker !== this) attacker.score += 3
      world.spawn(new Explosion({ pos: this.pos, rng: world.rng, color: this.color }))
      world.emit('exploded', { kind: 'ship', playerId: this.playerId, by: attacker?.playerId ?? 0, x: this.pos.x, y: this.pos.y })
    }
  }

  respawn(world: World): void {
    this.#hp = MAX_HP
    this.respawnIn = 0
    this.collidable = true
    this.vel = new Vector2()
    this.pos = world.findSafeSpot()
    this.remember()
    this.shield = 1.5
  }

  override onCollide(other: AnyEntity, world: World): void {
    if (other.kind === 'asteroid') {
      this.damage(34, world, null)
      // bounce away from the rock
      const away = this.pos.sub(other.pos).normalize()
      this.vel = away.scale(Math.max(120, this.vel.length() * 0.6))
    }
  }
}

export type { Seq }
