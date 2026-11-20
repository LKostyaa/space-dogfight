import { Entity } from './entity.js'
import { Vector2 } from './vector.js'
import { Bullet } from './bullet.js'
import { Explosion } from './explosion.js'
import { homing } from './behaviors.js'

// Tuning (see README "Налаштування керування"):
// TURN 3.4 rad/s  — a full turn in ~1.85 s, easy to aim, not a spinning top.
// THRUST 480      — noticeable acceleration in half a second.
// DRAG 0.9        — the ship drifts (space!) but stops within ~3 s.
// MAX_SPEED 360   — still readable at 60 Hz.
export const TURN = 3.4
export const THRUST = 480
export const DRAG = 0.9
export const MAX_SPEED = 360
export const MAX_HP = 100
export const FIRE_COOLDOWN = 0.25
export const RESPAWN_TIME = 2

const NO_CONTROLS = { left: false, right: false, thrust: false, fire: false }

/** Pure physics step shared by the class and (later) by the server. */
export function integrate(ship, controls, dt) {
  let angle = ship.angle
  if (controls.left) angle -= TURN * dt
  if (controls.right) angle += TURN * dt
  let vel = ship.vel
  if (controls.thrust) vel = vel.add(Vector2.fromAngle(angle, THRUST * dt))
  vel = vel.scale(Math.exp(-DRAG * dt)).clampLength(MAX_SPEED)
  return { angle, vel, pos: ship.pos.add(vel.scale(dt)) }
}

export class Ship extends Entity {
  #hp = MAX_HP

  constructor({ pos, angle = -Math.PI / 2, playerId, name = 'pilot', color = '#5ec8ff' }) {
    super({ kind: 'ship', pos, angle, radius: 14 })
    this.playerId = playerId
    this.name = name
    this.color = color
    this.score = 0
    this.controls = NO_CONTROLS
    this.cooldown = 0
    this.respawnIn = 0
    this.shield = 0 // seconds left
    this.rapidFire = 0 // seconds left
    this.homing = 0 // seconds left
  }

  get hp() {
    return this.#hp
  }
  get dead() {
    return this.respawnIn > 0
  }

  update(dt, world) {
    if (this.dead) {
      this.respawnIn -= dt
      if (this.respawnIn <= 0) this.respawn(world)
      return
    }
    for (const b of this.behaviors) b.update(this, world, dt)
    const next = integrate(this, this.controls, dt)
    this.angle = next.angle
    this.vel = next.vel
    this.pos = next.pos
    this.wrap()

    this.cooldown = Math.max(0, this.cooldown - dt)
    this.shield = Math.max(0, this.shield - dt)
    this.rapidFire = Math.max(0, this.rapidFire - dt)
    this.homing = Math.max(0, this.homing - dt)
    if (this.controls.fire && this.cooldown === 0) this.fire(world)
  }

  /** Spawns a bullet from the nose with the ship's velocity added ("inherited"). */
  fire(world) {
    const nose = this.pos.add(Vector2.fromAngle(this.angle, this.radius + 4))
    const bullet = new Bullet({ pos: nose, vel: this.vel.add(Vector2.fromAngle(this.angle, 620)), owner: this })
    if (this.homing > 0) bullet.behaviors.push(homing({ turnRate: 4 }))
    world.spawn(bullet)
    this.cooldown = this.rapidFire > 0 ? FIRE_COOLDOWN / 2.5 : FIRE_COOLDOWN
    world.emit('fired', { id: this.id, playerId: this.playerId })
  }

  damage(amount, world, attacker) {
    if (this.dead || this.shield > 0) return
    this.#hp -= amount
    world.emit('hit', { id: this.id })
    if (this.#hp <= 0) {
      this.respawnIn = RESPAWN_TIME
      this.collidable = false
      if (attacker && attacker !== this) attacker.score += 3
      world.spawn(new Explosion({ pos: this.pos, rng: world.rng, color: this.color }))
      world.emit('exploded', { id: this.id, by: attacker?.playerId })
    }
  }

  respawn(world) {
    this.#hp = MAX_HP
    this.respawnIn = 0
    this.collidable = true
    this.vel = new Vector2()
    this.pos = world.findSafeSpot()
    this.remember()
    this.shield = 1.5
  }

  onCollide(other, world) {
    if (other.kind === 'asteroid') {
      this.damage(34, world, null)
      // bounce away from the rock
      const away = this.pos.sub(other.pos).normalize()
      this.vel = away.scale(Math.max(120, this.vel.length() * 0.6))
    }
  }
}
