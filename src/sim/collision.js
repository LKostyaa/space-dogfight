/**
 * Collision system, separate from the World so it can be swapped
 * (naive O(n²) now, spatial hash in Lab 7).
 * `findPairs(entities)` -> iterable of [a, b] that overlap.
 */
export function circlesOverlap(a, b) {
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const r = a.radius + b.radius
  return dx * dx + dy * dy <= r * r
}

export function* naivePairs(entities) {
  const list = entities.filter((e) => e.alive && e.collidable)
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (circlesOverlap(list[i], list[j])) yield [list[i], list[j]]
    }
  }
}

export function resolveCollisions(world, findPairs = naivePairs) {
  for (const [a, b] of findPairs([...world])) {
    if (!a.alive || !b.alive) continue
    a.onCollide(b, world)
    b.onCollide(a, world)
  }
}
