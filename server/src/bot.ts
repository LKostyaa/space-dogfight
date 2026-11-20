import type { World } from '@dogfight/shared/sim/world.ts'
import type { Ship, Controls } from '@dogfight/shared/sim/ship.ts'
import { controlsToBits, type InputMsg } from '@dogfight/shared/protocol.ts'
import { toId, type Seq } from '@dogfight/shared/types.ts'
import type { Rng } from '@dogfight/shared/sim/rng.ts'

/** Anything that can drive a ship: a human over the network or a bot. Both produce the same InputMsg. */
export interface PlayerInput {
  /** Called once per server tick; returns the next input (or null if none arrived). */
  nextInput(world: World, ship: Ship): InputMsg | null
}

const angleTo = (from: Ship, x: number, y: number): number => Math.atan2(y - from.pos.y, x - from.pos.x)
const angleDiff = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/**
 * Server-side AI pilot. It goes through exactly the same path as a human:
 * an InputMsg with a seq and button bits -> Match.queueInput -> Ship.applyInput.
 * The server cannot tell bots and humans apart.
 */
export class Bot implements PlayerInput {
  #seq = 0
  readonly #rng: Rng
  #wander = 0

  constructor(rng: Rng) {
    this.#rng = rng
  }

  decide(world: World, me: Ship): Controls {
    // 1. evade: a rock very close in front -> turn away hard and thrust
    for (const rock of world.ofKind('asteroid')) {
      const d = rock.pos.sub(me.pos).length() - rock.radius
      if (d < 70) {
        const away = angleDiff(me.angle, angleTo(me, rock.pos.x, rock.pos.y) + Math.PI)
        return { left: away < 0, right: away > 0, thrust: true, fire: false }
      }
    }
    // 2. chase the nearest living ship and shoot when roughly aligned
    let target: Ship | null = null
    let best = Infinity
    for (const s of world.ofKind('ship')) {
      if (s === me || s.dead) continue
      const d = s.pos.sub(me.pos).length()
      if (d < best) {
        best = d
        target = s
      }
    }
    if (target) {
      const diff = angleDiff(me.angle, angleTo(me, target.pos.x, target.pos.y))
      return { left: diff < -0.08, right: diff > 0.08, thrust: best > 220, fire: Math.abs(diff) < 0.25 && best < 600 }
    }
    // 3. nobody around: wander
    if (--this.#wander <= 0) this.#wander = 20 + this.#rng.int(40)
    const turn = this.#wander % 3
    return { left: turn === 0, right: turn === 1, thrust: true, fire: false }
  }

  nextInput(world: World, ship: Ship): InputMsg | null {
    if (ship.dead) return null
    return { seq: toId<Seq>(++this.#seq), bits: controlsToBits(this.decide(world, ship)) }
  }
}
