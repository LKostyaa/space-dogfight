import { EventEmitter } from 'node:events'

/**
 * A room: players + events. Emits "join", "leave", "chat", "empty", and a
 * generic "event" ({ t, type, ... }) that the match log consumes.
 */
export class Room extends EventEmitter {
  constructor({ id, name, arena = 'classic', maxPlayers = 8, persistent = false }) {
    super()
    this.id = id
    this.name = name
    this.arena = arena
    this.maxPlayers = maxPlayers
    this.persistent = persistent
    this.players = new Map() // playerId -> { id, name, socket }
    this.createdAt = Date.now()
  }

  get full() {
    return this.players.size >= this.maxPlayers
  }

  #record(type, data) {
    this.emit('event', { t: Date.now(), room: this.id, type, ...data })
  }

  join(player) {
    this.players.set(player.id, player)
    this.emit('join', player)
    this.#record('join', { playerId: player.id, name: player.name })
  }

  leave(playerId) {
    const p = this.players.get(playerId)
    if (!p) return
    this.players.delete(playerId)
    this.emit('leave', p)
    this.#record('leave', { playerId })
    if (this.players.size === 0) this.emit('empty', this)
  }

  chat(playerId, text) {
    const p = this.players.get(playerId)
    if (!p) return
    const msg = { from: p.name, playerId, text, t: Date.now() }
    this.emit('chat', msg)
    this.#record('chat', { playerId, text })
  }

  /** Anything game-related (kills, pickups) also goes to the log. */
  record(type, data) {
    this.#record(type, data)
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }))
  }

  toJSON() {
    return { id: this.id, name: this.name, arena: this.arena, players: this.players.size, maxPlayers: this.maxPlayers }
  }
}

export class RoomManager extends EventEmitter {
  #rooms = new Map()

  constructor({ maxRooms, maxPlayersPerRoom }) {
    super()
    this.maxRooms = maxRooms
    this.maxPlayersPerRoom = maxPlayersPerRoom
  }

  list() {
    return [...this.#rooms.values()]
  }

  get(id) {
    return this.#rooms.get(id)
  }

  get size() {
    return this.#rooms.size
  }

  create({ id, name, arena, maxPlayers, persistent = false }) {
    if (this.#rooms.has(id)) throw new Error(`room ${id} exists`)
    if (this.#rooms.size >= this.maxRooms) throw new Error('too many rooms')
    const room = new Room({ id, name, arena, maxPlayers: Math.min(maxPlayers ?? 8, this.maxPlayersPerRoom), persistent })
    this.#rooms.set(id, room)
    room.on('empty', () => {
      if (!room.persistent) this.delete(id)
    })
    this.emit('created', room)
    return room
  }

  delete(id) {
    const room = this.#rooms.get(id)
    if (!room) return
    this.#rooms.delete(id)
    room.emit('closed')
    room.removeAllListeners()
    this.emit('deleted', room)
  }
}
