import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import type { PlayerId } from '@dogfight/shared/types.ts'
import type { ArenaName } from '@dogfight/shared/sim/arenas.ts'
import type { Match } from './match.ts'

export interface RoomPlayer {
  readonly id: PlayerId
  readonly name: string
  readonly socket: WebSocket | null // null for bots
}

export interface ChatMessage {
  readonly from: string
  readonly playerId: PlayerId
  readonly text: string
  readonly t: number
}

export interface LogEvent {
  readonly t: number
  readonly room: string
  readonly type: string
  readonly [field: string]: unknown
}

/** Typed events: room.on('chat', m => …) knows `m` is a ChatMessage. */
export interface RoomEvents {
  join: [player: RoomPlayer]
  leave: [player: RoomPlayer]
  chat: [message: ChatMessage]
  empty: [room: Room]
  event: [event: LogEvent]
  closed: []
  'log:end': []
}

export interface RoomInit {
  id: string
  name: string
  arena?: ArenaName
  maxPlayers?: number
  persistent?: boolean
}

/** A room: players + events. The generic "event" ({ t, type, ... }) feeds the match log. */
export class Room extends EventEmitter<RoomEvents> {
  readonly id: string
  readonly name: string
  readonly arena: ArenaName
  readonly maxPlayers: number
  readonly persistent: boolean
  readonly players = new Map<PlayerId, RoomPlayer>()
  readonly createdAt = Date.now()
  match: Match | null = null
  wired = false

  constructor({ id, name, arena = 'classic', maxPlayers = 8, persistent = false }: RoomInit) {
    super()
    this.id = id
    this.name = name
    this.arena = arena
    this.maxPlayers = maxPlayers
    this.persistent = persistent
  }

  get full(): boolean {
    return this.players.size >= this.maxPlayers
  }

  #record(type: string, data: Record<string, unknown>): void {
    this.emit('event', { t: Date.now(), room: this.id, type, ...data })
  }

  join(player: RoomPlayer): void {
    this.players.set(player.id, player)
    this.emit('join', player)
    this.#record('join', { playerId: player.id, name: player.name })
  }

  leave(playerId: PlayerId): void {
    const p = this.players.get(playerId)
    if (!p) return
    this.players.delete(playerId)
    this.emit('leave', p)
    this.#record('leave', { playerId })
    if (this.players.size === 0) this.emit('empty', this)
  }

  chat(playerId: PlayerId, text: string): void {
    const p = this.players.get(playerId)
    if (!p) return
    this.emit('chat', { from: p.name, playerId, text, t: Date.now() })
    this.#record('chat', { playerId, text })
  }

  /** Anything game-related (kills, pickups) also goes to the log. */
  record(type: string, data: object): void {
    this.#record(type, { ...data })
  }

  roster(): { id: PlayerId; name: string }[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }))
  }

  toJSON() {
    return { id: this.id, name: this.name, arena: this.arena, players: this.players.size, maxPlayers: this.maxPlayers }
  }
}

export interface RoomManagerEvents {
  created: [room: Room]
  deleted: [room: Room]
}

export class RoomManager extends EventEmitter<RoomManagerEvents> {
  readonly #rooms = new Map<string, Room>()
  readonly maxRooms: number
  readonly maxPlayersPerRoom: number

  constructor({ maxRooms, maxPlayersPerRoom }: { maxRooms: number; maxPlayersPerRoom: number }) {
    super()
    this.maxRooms = maxRooms
    this.maxPlayersPerRoom = maxPlayersPerRoom
  }

  list(): Room[] {
    return [...this.#rooms.values()]
  }

  get(id: string): Room | undefined {
    return this.#rooms.get(id)
  }

  get size(): number {
    return this.#rooms.size
  }

  create({ id, name, arena, maxPlayers, persistent = false }: RoomInit): Room {
    if (this.#rooms.has(id)) throw new Error(`room ${id} exists`)
    if (this.#rooms.size >= this.maxRooms) throw new Error('too many rooms')
    const room = new Room({ id, name, ...(arena ? { arena } : {}), maxPlayers: Math.min(maxPlayers ?? 8, this.maxPlayersPerRoom), persistent })
    this.#rooms.set(id, room)
    room.on('empty', () => {
      if (!room.persistent) this.delete(id)
    })
    this.emit('created', room)
    return room
  }

  delete(id: string): void {
    const room = this.#rooms.get(id)
    if (!room) return
    this.#rooms.delete(id)
    room.emit('closed')
    room.removeAllListeners()
    this.emit('deleted', room)
  }
}
