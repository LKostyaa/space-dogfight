import { Vector2 } from './vector.ts'

export interface ArenaSize {
  readonly width: number
  readonly height: number
}

export const ARENA: ArenaSize = { width: 1600, height: 900 }

const mod = (a: number, n: number): number => ((a % n) + n) % n

/** Wrap-around: leaving one edge brings you back on the opposite one. */
export function wrapPos(p: Vector2, arena: ArenaSize = ARENA): Vector2 {
  if (p.x >= 0 && p.x < arena.width && p.y >= 0 && p.y < arena.height) return p
  return new Vector2(mod(p.x, arena.width), mod(p.y, arena.height))
}
