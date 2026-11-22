import { ARENA } from './arena.ts'
import { Vector2 } from './vector.ts'
import { createRng, type Rng } from './rng.ts'
import { resolveCollisions, type FindPairs } from './collision.ts'
import { spatialHashPairs } from './spatial-hash.ts'
import { Asteroid } from './asteroid.ts'
import { Pickup, EFFECT_NAMES, type Effect } from './pickup.ts'
import { homing } from './behaviors.ts'
import { isKind, type AnyEntity, type EntityKind, type EntityOfKind } from './kinds.ts'
import type { Controls } from './ship.ts'
import type { EntityId, PlayerId } from '../types.ts'

export interface GameEvents {
  fired: { playerId: PlayerId; x: number; y: number }
  hit: { kind: 'ship'; playerId: PlayerId; x: number; y: number }
  exploded: { kind: 'ship' | 'asteroid'; playerId?: PlayerId; by: PlayerId | 0; x: number; y: number }
  pickup: { playerId: PlayerId; effect: Effect; x: number; y: number }
}
export type GameEventType = keyof GameEvents
export type GameEvent = { [K in GameEventType]: { type: K } & GameEvents[K] }[GameEventType]

/**
 * Typed event bus: event names and their details come from the map `E`.
 * (Lab 3 used a plain EventTarget + CustomEvent; its `detail` is `any`, which
 * typescript-eslint rightly flagged — this keeps the same API, fully typed.)
 */
export class Bus<E extends object> {
  readonly #listeners: { [K in keyof E]?: Set<(detail: E[K]) => void> } = {}

  emit<K extends keyof E & string>(type: K, detail: E[K]): void {
    for (const fn of this.#listeners[type] ?? []) fn(detail)
  }

  on<K extends keyof E & string>(type: K, fn: (detail: E[K]) => void): () => void {
    const set = (this.#listeners[type] ??= new Set())
    set.add(fn)
    return () => set.delete(fn)
  }
}

export class World {
  readonly #entities = new Map<EntityId, AnyEntity>()
  readonly #dead = new Set<EntityId>()
  readonly rng: Rng
  readonly findPairs: FindPairs
  readonly bus = new Bus<GameEvents>()
  time = 0
  stepEvents: GameEvent[] = []
  targets = { asteroids: 0, pickups: 0 }
  maintenanceIn = 0

  constructor({ seed = 1, findPairs = spatialHashPairs() }: { seed?: number; findPairs?: FindPairs } = {}) {
    this.rng = createRng(seed)
    this.findPairs = findPairs
  }

  spawn<T extends AnyEntity>(e: T): T {
    this.#entities.set(e.id, e)
    return e
  }

  /** Deferred: mark now, remove in sweep() at the end of the step. */
  despawn(id: EntityId): void {
    const e = this.#entities.get(id)
    if (e) e.alive = false
    this.#dead.add(id)
  }

  get(id: EntityId): AnyEntity | undefined {
    return this.#entities.get(id)
  }

  get size(): number {
    return this.#entities.size
  }

  [Symbol.iterator](): IterableIterator<AnyEntity> {
    return this.#entities.values()
  }

  *ofKind<K extends EntityKind>(kind: K): Generator<EntityOfKind<K>> {
    for (const e of this.#entities.values()) if (isKind(e, kind) && e.alive) yield e
  }

  emit<K extends GameEventType>(type: K, detail: GameEvents[K]): void {
    this.stepEvents.push({ type, ...detail } as GameEvent) // cast 2 of 2: TS can't correlate K across the spread (TS#30581)
    this.bus.emit(type, detail)
  }

  /** Returns and clears the events of the steps since the last call. */
  drainEvents(): GameEvent[] {
    const events = this.stepEvents
    this.stepEvents = []
    return events
  }

  step(dt: number, inputs: ReadonlyMap<PlayerId, Controls> = new Map()): void {
    for (const e of this.#entities.values()) if (!e.driven) e.remember()
    for (const ship of this.ofKind('ship')) if (!ship.driven) ship.controls = inputs.get(ship.playerId) ?? ship.controls
    for (const e of this.#entities.values()) if (e.alive) e.update(dt, this)
    resolveCollisions(this, this.findPairs)
    this.sweep()
    this.time += dt
    this.maintenanceIn -= dt
    if (this.maintenanceIn <= 0) this.maintain()
  }

  maintain(): void {
    this.maintenanceIn = 5
    let rocks = 0
    for (const _ of this.ofKind('asteroid')) rocks++
    if (rocks < this.targets.asteroids) {
      const edge =
        this.rng.int(2) === 0 ? new Vector2(0, this.rng.range(0, ARENA.height)) : new Vector2(this.rng.range(0, ARENA.width), 0)
      this.spawn(
        new Asteroid({
          pos: edge,
          vel: Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60)),
          radius: this.rng.range(26, 40),
          spin: this.rng.range(-1, 1),
        }),
      )
    }
    let pickups = 0
    for (const _ of this.ofKind('pickup')) pickups++
    if (pickups < this.targets.pickups) {
      this.spawn(new Pickup({ pos: this.findSafeSpot(), effect: EFFECT_NAMES[this.rng.int(EFFECT_NAMES.length)] ?? 'shield' }))
    }
  }

  sweep(): void {
    for (const id of this.#dead) this.#entities.delete(id)
    this.#dead.clear()
  }

  findSafeSpot(): Vector2 {
    for (let tries = 0; tries < 30; tries++) {
      const p = new Vector2(this.rng.range(60, ARENA.width - 60), this.rng.range(60, ARENA.height - 60))
      let ok = true
      for (const e of this) if (e.collidable && e.kind !== 'bullet' && e.pos.sub(p).length() < e.radius + 120) ok = false
      if (ok) return p
    }
    return new Vector2(ARENA.width / 2, ARENA.height / 2)
  }

  /** Populate the arena with rocks and power-ups. */
  populate({ asteroids = 6, pickups = 3 }: { asteroids?: number; pickups?: number } = {}): void {
    this.targets = { asteroids, pickups }
    this.maintenanceIn = 5
    for (let i = 0; i < asteroids; i++) {
      this.spawn(
        new Asteroid({
          pos: this.findSafeSpot(),
          vel: Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(20, 60)),
          radius: this.rng.range(22, 40),
          spin: this.rng.range(-1, 1),
        }),
      )
    }
    // one "hunter" rock: the same homing behavior as homing bullets
    const hunter = this.spawn(new Asteroid({ pos: this.findSafeSpot(), vel: new Vector2(40, 0), radius: 18, spin: 2 }))
    hunter.behaviors.push(homing({ turnRate: 0.6, range: 600 }))
    for (let i = 0; i < pickups; i++) {
      this.spawn(new Pickup({ pos: this.findSafeSpot(), effect: EFFECT_NAMES[i % EFFECT_NAMES.length] ?? 'shield' }))
    }
  }
}
