import type { Ship } from './ship.ts'
import type { Bullet } from './bullet.ts'
import type { Asteroid } from './asteroid.ts'
import type { Explosion } from './explosion.ts'
import type { Pickup } from './pickup.ts'

export type AnyEntity = Ship | Bullet | Asteroid | Explosion | Pickup
export type EntityKind = AnyEntity['kind']
export type EntityOfKind<K extends EntityKind> = Extract<AnyEntity, { kind: K }>

export function isKind<K extends EntityKind>(e: AnyEntity, kind: K): e is EntityOfKind<K> {
  return e.kind === kind
}
