import { ShipFlag } from '../protocol/messages.js'

/**
 * World -> plain, codec-independent snapshot. `ack` (lastProcessedSeq) is
 * per client and is added by the server when sending.
 */
export function worldToSnapshot(world, tick, events = []) {
  const entities = []
  for (const e of world) {
    if (!e.alive) continue
    switch (e.kind) {
      case 'ship':
        entities.push({
          kind: 'ship',
          id: e.id,
          playerId: e.playerId,
          x: e.pos.x,
          y: e.pos.y,
          vx: e.vel.x,
          vy: e.vel.y,
          angle: e.angle,
          hp: Math.max(0, e.hp),
          score: e.score,
          flags:
            (e.controls.thrust ? ShipFlag.THRUST : 0) |
            (e.shield > 0 ? ShipFlag.SHIELD : 0) |
            (e.rapidFire > 0 ? ShipFlag.RAPID : 0) |
            (e.homing > 0 ? ShipFlag.HOMING : 0) |
            (e.dead ? ShipFlag.DEAD : 0),
        })
        break
      case 'bullet':
        entities.push({
          kind: 'bullet',
          id: e.id,
          owner: e.owner?.playerId ?? 0,
          seq: e.seq ?? 0,
          x: e.pos.x,
          y: e.pos.y,
          vx: e.vel.x,
          vy: e.vel.y,
          homing: e.behaviors.length > 0,
        })
        break
      case 'asteroid':
        entities.push({ kind: 'asteroid', id: e.id, x: e.pos.x, y: e.pos.y, angle: e.angle, radius: e.radius, homing: e.behaviors.length > 0 })
        break
      case 'pickup':
        entities.push({ kind: 'pickup', id: e.id, x: e.pos.x, y: e.pos.y, effect: e.effect })
        break
      // explosions are client-side visuals, triggered by "exploded" events
    }
  }
  return {
    tick,
    entities,
    events: events.map((ev) => ({
      type: ev.type,
      kind: ev.kind ?? '',
      effect: ev.effect ?? '',
      x: ev.x ?? 0,
      y: ev.y ?? 0,
      playerId: ev.playerId ?? 0,
      by: ev.by ?? 0,
    })),
  }
}
