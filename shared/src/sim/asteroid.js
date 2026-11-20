import { Entity } from './entity.js'
import { Explosion } from './explosion.js'

export class Asteroid extends Entity {
  #hp

  constructor({ pos, vel, radius = 34, spin = 0.5 }) {
    super({ kind: 'asteroid', pos, vel, radius })
    this.spin = spin
    this.#hp = radius * 2
  }

  get hp() {
    return this.#hp
  }

  update(dt, world) {
    super.update(dt, world)
    this.angle += this.spin * dt
  }

  damage(amount, world, attacker) {
    this.#hp -= amount
    if (this.#hp > 0) return
    world.despawn(this.id)
    world.spawn(new Explosion({ pos: this.pos, rng: world.rng, color: '#b8a58a' }))
    world.emit('exploded', { id: this.id, kind: 'asteroid', by: attacker?.playerId, x: this.pos.x, y: this.pos.y })
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

  onCollide(other) {
    // asteroids bounce off each other
    if (other.kind !== 'asteroid') return
    const n = this.pos.sub(other.pos).normalize()
    if (this.vel.sub(other.vel).dot(n) < 0) this.vel = this.vel.sub(n.scale(2 * this.vel.dot(n)))
  }
}
