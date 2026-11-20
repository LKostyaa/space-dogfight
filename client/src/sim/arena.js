export const ARENA = { width: 1600, height: 900 }

/** Wrap-around: leaving one edge brings you back on the opposite one. */
export function wrap(obj, arena = ARENA) {
  const w = arena.width
  const h = arena.height
  return { ...obj, x: ((obj.x % w) + w) % w, y: ((obj.y % h) + h) % h }
}
