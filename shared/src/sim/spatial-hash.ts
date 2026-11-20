import { circlesOverlap, type Pair } from './collision.ts'
import type { AnyEntity } from './kinds.ts'

/**
 * Broad phase with a uniform grid: each entity is put into every cell its
 * bounding box touches; only entities sharing a cell are tested. With bullets
 * everywhere this is ~O(n) instead of O(n²). Drop-in replacement for naivePairs
 * (same signature, same pairs — a property test checks that).
 */
export function spatialHashPairs(cellSize = 64) {
  return function* (entities: readonly AnyEntity[]): Generator<Pair> {
    const cells = new Map<number, AnyEntity[]>()
    for (const e of entities) {
      if (!e.alive || !e.collidable) continue
      const x0 = Math.floor((e.pos.x - e.radius) / cellSize)
      const x1 = Math.floor((e.pos.x + e.radius) / cellSize)
      const y0 = Math.floor((e.pos.y - e.radius) / cellSize)
      const y1 = Math.floor((e.pos.y + e.radius) / cellSize)
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = (cx + 1024) * 4096 + (cy + 1024)
          const bucket = cells.get(key)
          if (bucket) bucket.push(e)
          else cells.set(key, [e])
        }
      }
    }
    const seen = new Set<number>()
    for (const bucket of cells.values()) {
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i]
        if (!a) continue
        for (let j = i + 1; j < bucket.length; j++) {
          const b = bucket[j]
          if (!b) continue
          // the same pair can share several cells: report it once
          const key = a.id < b.id ? a.id * 65536 + b.id : b.id * 65536 + a.id
          if (seen.has(key)) continue
          seen.add(key)
          if (circlesOverlap(a, b)) yield a.id < b.id ? [a, b] : [b, a]
        }
      }
    }
  }
}
