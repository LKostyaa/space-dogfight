import { Vector2 } from './vector.ts'
import { wrapPos } from './arena.ts'
import { toId, type EntityId } from '../types.ts'
import type { AnyEntity, EntityKind } from './kinds.ts'
import type { World } from './world.ts'
import type { Ship } from './ship.ts'

/** A behavior attached to an entity (composition instead of a deeper class tree). */
export interface Behavior {
  readonly name: string
  update(entity: Entity, world: World, dt: number): void
}

export interface EntityInit {
  pos?: Vector2
  vel?: Vector2
  angle?: number
  radius?: number
}

/**
 * Base class for everything in the world. Ids come from a private static
 * counter, so nothing outside the class can forge or reset them.
 */
export abstract class Entity {
  static #nextId = 1
  static resetIds(n = 1): void {
    Entity.#nextId = n
  }

  abstract readonly kind: EntityKind
  readonly id: EntityId
  pos: Vector2
  vel: Vector2
  angle: number
  radius: number
  alive = true
  collidable = true
  /** Networked player ships are moved per input by the server's Match (see Ship). */
  driven = false
  /** Who fired / owns this entity (bullets). Homing uses it to not chase its own ship. */
  owner: Ship | null = null
  behaviors: Behavior[] = []
  prevPos: Vector2
  prevAngle: number

  constructor({ pos = new Vector2(), vel = new Vector2(), angle = 0, radius = 10 }: EntityInit) {
    this.id = toId<EntityId>(Entity.#nextId++)
    this.pos = pos
    this.vel = vel
    this.angle = angle
    this.radius = radius
    this.prevPos = pos
    this.prevAngle = angle
  }

  /** Saved at the start of each step so the renderer can lerp(prev, current, alpha). */
  remember(): void {
    this.prevPos = this.pos
    this.prevAngle = this.angle
  }

  update(dt: number, world: World): void {
    for (const b of this.behaviors) b.update(this, world, dt)
    this.pos = this.pos.add(this.vel.scale(dt))
    this.wrap()
  }

  wrap(): void {
    this.pos = wrapPos(this.pos)
  }

  /** Called by the collision system. Default: nothing happens. */
  onCollide(_other: AnyEntity, _world: World): void {}
}
