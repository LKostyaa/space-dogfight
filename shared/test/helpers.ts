import { toId, type PlayerId, type Seq } from '../src/types.ts'
import { Vector2 } from '../src/sim/vector.ts'
import type { Controls } from '../src/sim/ship.ts'

export const pid = (n: number): PlayerId => toId<PlayerId>(n)
export const seq = (n: number): Seq => toId<Seq>(n)
export const v = (x: number, y: number): Vector2 => new Vector2(x, y)
export const controls = (c: Partial<Controls> = {}): Controls => ({ left: false, right: false, thrust: false, fire: false, ...c })
