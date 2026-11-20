import type { AnyEntity } from './kinds.ts'
import type { World } from './world.ts'

export type Pair = readonly [AnyEntity, AnyEntity]
/** A broad phase: given entities, yield the pairs that overlap. Swappable (naive now, spatial hash in Lab 7). */
export type FindPairs = (entities: readonly AnyEntity[]) => Iterable<Pair>

interface Circle {
  readonly pos: { readonly x: number; readonly y: number }
  readonly radius: number
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const r = a.radius + b.radius
  return dx * dx + dy * dy <= r * r
}

export function* naivePairs(entities: readonly AnyEntity[]): Generator<Pair> {
  const list = entities.filter((e) => e.alive && e.collidable)
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a) continue
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]
      if (b && circlesOverlap(a, b)) yield [a, b]
    }
  }
}

export function resolveCollisions(world: World, findPairs: FindPairs = naivePairs): void {
  for (const [a, b] of findPairs([...world])) {
    if (!a.alive || !b.alive) continue
    a.onCollide(b, world)
    b.onCollide(a, world)
  }
}
