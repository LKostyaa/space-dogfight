/**
 * Branded numbers: an EntityId and a PlayerId are both numbers at runtime,
 * but the compiler refuses to mix them up (passing a ship id where a player id
 * is expected was an actual bug — see README "What TypeScript found").
 */
declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type EntityId = Brand<number, 'EntityId'>
export type PlayerId = Brand<number, 'PlayerId'>
export type Tick = Brand<number, 'Tick'>
export type Seq = Brand<number, 'Seq'>

type AnyId = EntityId | PlayerId | Tick | Seq

/**
 * The single place where a plain number becomes a branded id.
 * `as` is unavoidable here: a brand only exists in the type system. (cast 1 of 2)
 */
export function toId<T extends AnyId>(n: number): T {
  return n as T
}

export type Result<T, E = string> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/** Exhaustiveness check: calling this means a `switch` forgot a case. */
export function assertNever(x: never, what = 'value'): never {
  throw new Error(`Unexpected ${what}: ${JSON.stringify(x)}`)
}
