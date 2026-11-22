import { z } from 'zod'
import { toId, ok, err, type EntityId, type PlayerId, type Seq, type Tick, type Result } from './types.ts'
import { EFFECT_NAMES, type Effect } from './sim/pickup.ts'
import type { Controls } from './sim/ship.ts'

export const PROTOCOL_VERSION = 1

// ---------- small building blocks ----------
const v = z.literal(PROTOCOL_VERSION)
const uint = z.number().int().nonnegative()
const entityId = uint.max(0xffff).transform((n) => toId<EntityId>(n))
const playerId = uint.max(0xff).transform((n) => toId<PlayerId>(n))
const seq = uint.max(0xffffffff).transform((n) => toId<Seq>(n))
const tick = uint.max(0xffffffff).transform((n) => toId<Tick>(n))
const finite = z.number().finite()
const effect = z.enum(['shield', 'rapid', 'homing'])

// ---------- client -> server ----------
export const CodecNameSchema = z.enum(['binary', 'json'])
export type CodecName = z.infer<typeof CodecNameSchema>

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v,
    type: z.literal('join'),
    room: z.string().regex(/^[a-z0-9-]{1,32}$/),
    name: z.string().min(1).max(16).regex(/^[\p{L}\p{N} _.-]+$/u),
    codec: CodecNameSchema.optional(),
  }),
  z.object({ v, type: z.literal('chat'), text: z.string().min(1).max(200) }),
  z.object({ v, type: z.literal('ping'), t: finite }),
  z.object({ v, type: z.literal('leave') }),
  z.object({ v, type: z.literal('input'), seq, b: uint.max(15) }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export function parseClientMessage(data: unknown): Result<ClientMessage> {
  let raw: unknown = data
  if (typeof data === 'string') {
    try {
      raw = JSON.parse(data)
    } catch {
      return err('not json')
    }
  }
  const r = ClientMessageSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    return err(issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'invalid message')
  }
  return ok(r.data)
}

// ---------- snapshots (codec-independent shape) ----------
export const ShipSnapSchema = z.object({
  kind: z.literal('ship'),
  id: entityId,
  playerId,
  x: finite,
  y: finite,
  vx: finite,
  vy: finite,
  angle: finite,
  hp: uint.max(255),
  score: uint,
  flags: uint.max(255),
})
export const BulletSnapSchema = z.object({
  kind: z.literal('bullet'),
  id: entityId,
  owner: playerId,
  seq: uint.max(0xffff),
  x: finite,
  y: finite,
  vx: finite,
  vy: finite,
  homing: z.boolean(),
})
export const AsteroidSnapSchema = z.object({
  kind: z.literal('asteroid'),
  id: entityId,
  x: finite,
  y: finite,
  angle: finite,
  radius: finite,
  homing: z.boolean(),
})
export const PickupSnapSchema = z.object({ kind: z.literal('pickup'), id: entityId, x: finite, y: finite, effect })

export const EntitySnapSchema = z.discriminatedUnion('kind', [ShipSnapSchema, BulletSnapSchema, AsteroidSnapSchema, PickupSnapSchema])
export type ShipSnap = Readonly<z.infer<typeof ShipSnapSchema>>
export type BulletSnap = Readonly<z.infer<typeof BulletSnapSchema>>
export type AsteroidSnap = Readonly<z.infer<typeof AsteroidSnapSchema>>
export type PickupSnap = Readonly<z.infer<typeof PickupSnapSchema>>
export type EntitySnap = ShipSnap | BulletSnap | AsteroidSnap | PickupSnap
export type NetKind = EntitySnap['kind']

export const EventSnapSchema = z.object({
  type: z.enum(['fired', 'hit', 'exploded', 'pickup']),
  kind: z.enum(['', 'ship', 'bullet', 'asteroid', 'pickup']),
  effect: z.union([z.literal(''), effect]),
  x: finite,
  y: finite,
  playerId: uint.max(255),
  by: uint.max(255),
})
export type EventSnap = Readonly<z.infer<typeof EventSnapSchema>>

export const SnapshotSchema = z.object({
  tick,
  ack: seq,
  entities: z.array(EntitySnapSchema).max(65535),
  events: z.array(EventSnapSchema).max(255),
})
export interface Snapshot {
  readonly tick: Tick
  readonly ack: Seq
  readonly entities: readonly EntitySnap[]
  readonly events: readonly EventSnap[]
}

export interface InputMsg {
  readonly seq: Seq
  readonly bits: number
}

// ---------- server -> client (JSON) ----------
export const RosterEntrySchema = z.object({ id: playerId, name: z.string(), color: z.string().optional() })
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('welcome'), playerId, room: z.object({ id: z.string(), name: z.string() }).passthrough(), tickRate: uint, codec: CodecNameSchema }),
  z.object({ v, type: z.literal('roster'), players: z.array(RosterEntrySchema) }),
  z.object({ v, type: z.literal('chat'), from: z.string(), playerId, text: z.string(), t: finite }),
  z.object({ v, type: z.literal('pong'), t: finite }),
  z.object({ v, type: z.literal('shutdown') }),
])
export type ServerMessage = z.infer<typeof ServerMessageSchema>
export type ServerMessageType = ServerMessage['type']
export type RosterEntry = z.infer<typeof RosterEntrySchema>

export function parseServerMessage(data: unknown): Result<ServerMessage> {
  const r = ServerMessageSchema.safeParse(data)
  return r.success ? ok(r.data) : err(r.error.issues[0]?.message ?? 'invalid')
}

export function encodeServerMessage(msg: z.input<typeof ServerMessageSchema>): string {
  return JSON.stringify(msg)
}

// ---------- binary constants ----------
export const BinaryType = { SNAPSHOT: 1, INPUT: 2 } as const
export const Buttons = { LEFT: 1, RIGHT: 2, THRUST: 4, FIRE: 8 } as const
export const ShipFlag = { THRUST: 1, SHIELD: 2, RAPID: 4, HOMING: 8, DEAD: 16 } as const

export const KIND_CODE: Readonly<Record<NetKind, number>> = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 }
export const KIND_BY_CODE: readonly (NetKind | undefined)[] = [undefined, 'ship', 'bullet', 'asteroid', 'pickup']

export type EventType = EventSnap['type']
export const EVENT_CODE: Readonly<Record<EventType, number>> = { fired: 1, hit: 2, exploded: 3, pickup: 4 }
export const EVENT_BY_CODE: readonly (EventType | undefined)[] = [undefined, 'fired', 'hit', 'exploded', 'pickup']

export const EFFECTS: readonly Effect[] = EFFECT_NAMES

export function controlsToBits(c: Controls): number {
  return (c.left ? Buttons.LEFT : 0) | (c.right ? Buttons.RIGHT : 0) | (c.thrust ? Buttons.THRUST : 0) | (c.fire ? Buttons.FIRE : 0)
}

export function bitsToControls(b: number): Controls {
  return {
    left: (b & Buttons.LEFT) !== 0,
    right: (b & Buttons.RIGHT) !== 0,
    thrust: (b & Buttons.THRUST) !== 0,
    fire: (b & Buttons.FIRE) !== 0,
  }
}
