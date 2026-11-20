export const ARENA = { width: 1600, height: 900 }

import { Vector2 } from './vector.js'

const mod = (a, n) => ((a % n) + n) % n

/** Wrap-around for a position vector. */
export function wrapPos(p, arena = ARENA) {
  if (p.x >= 0 && p.x < arena.width && p.y >= 0 && p.y < arena.height) return p
  return new Vector2(mod(p.x, arena.width), mod(p.y, arena.height))
}

/** Wrap-around: leaving one edge brings you back on the opposite one. */
export function wrap(obj, arena = ARENA) {
  const w = arena.width
  const h = arena.height
  return { ...obj, x: ((obj.x % w) + w) % w, y: ((obj.y % h) + h) % h }
}
