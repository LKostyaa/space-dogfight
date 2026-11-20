/**
 * Behaviors are plain objects attached to any entity: `entity.behaviors.push(homing())`.
 * The same homing works for a bullet AND for an asteroid — with inheritance we
 * would need HomingBullet and HomingAsteroid (or a deep tree).
 */
export function homing({ turnRate = 2.5, range = 450 } = {}) {
  return {
    name: 'homing',
    update(entity, world, dt) {
      let best = null
      let bestDist = range
      for (const ship of world.ofKind('ship')) {
        if (ship.dead || ship === entity.owner) continue
        const d = ship.pos.sub(entity.pos).length()
        if (d < bestDist) {
          best = ship
          bestDist = d
        }
      }
      if (!best) return
      const speed = entity.vel.length()
      const current = Math.atan2(entity.vel.y, entity.vel.x)
      const desired = Math.atan2(best.pos.y - entity.pos.y, best.pos.x - entity.pos.x)
      let diff = desired - current
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, diff))
      entity.vel = entity.vel.rotate(turn).normalize().scale(speed)
    },
  }
}
