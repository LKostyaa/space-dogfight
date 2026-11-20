import { ShipFlag, type EntitySnap, type EventSnap } from '../protocol.ts'
import { assertNever, toId, type Tick, type Seq } from '../types.ts'
import type { World, GameEvent } from '../sim/world.ts'

/** A snapshot before the per-client `ack` is added by the server. */
export interface WorldSnapshot {
  readonly tick: Tick
  readonly entities: readonly EntitySnap[]
  readonly events: readonly EventSnap[]
}

export function eventToSnap(ev: GameEvent): EventSnap {
  const base = { type: ev.type, x: ev.x, y: ev.y, kind: '' as const, effect: '' as const, playerId: 0, by: 0 }
  switch (ev.type) {
    case 'fired':
      return { ...base, playerId: ev.playerId }
    case 'hit':
      return { ...base, kind: ev.kind, playerId: ev.playerId }
    case 'exploded':
      return { ...base, kind: ev.kind, playerId: ev.playerId ?? 0, by: ev.by }
    case 'pickup':
      return { ...base, effect: ev.effect, playerId: ev.playerId }
    default:
      return assertNever(ev, 'event')
  }
}

/** World -> plain, codec-independent snapshot. */
export function worldToSnapshot(world: World, tick: number, events: readonly GameEvent[] = []): WorldSnapshot {
  const entities: EntitySnap[] = []
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
          owner: e.owner?.playerId ?? toId(0),
          seq: e.seq & 0xffff,
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
      case 'explosion':
        break // client-side visual, triggered by the "exploded" event
      default:
        assertNever(e, 'entity')
    }
  }
  return { tick: toId<Tick>(tick), entities, events: events.map(eventToSnap) }
}

export const withAck = (s: WorldSnapshot, ack: Seq) => ({ ...s, ack })
