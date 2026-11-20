import { describe, it, expect } from 'vitest'
import { toId, type PlayerId } from '@dogfight/shared/types.ts'
import { Room, RoomManager } from '../src/rooms.ts'

const pid = (n: number): PlayerId => toId<PlayerId>(n)

describe('rooms', () => {
  it('join / leave keep the roster and emit typed events', () => {
    const room = new Room({ id: 'r', name: 'R' })
    const seen: string[] = []
    room.on('join', (p) => seen.push(`join ${p.name}`))
    room.on('leave', (p) => seen.push(`leave ${p.name}`))
    room.join({ id: pid(1), name: 'a', socket: null })
    expect(room.roster()).toEqual([{ id: 1, name: 'a' }])
    room.leave(pid(1))
    expect(seen).toEqual(['join a', 'leave a'])
  })
  it('chat is attributed to the player', () => {
    const room = new Room({ id: 'r', name: 'R' })
    room.join({ id: pid(1), name: 'a', socket: null })
    let msg = ''
    room.on('chat', (m) => (msg = `${m.from}: ${m.text}`))
    room.chat(pid(1), 'hi')
    room.chat(pid(9), 'ghost') // not in the room: ignored
    expect(msg).toBe('a: hi')
  })
  it('a non-persistent room is deleted when it becomes empty', () => {
    const m = new RoomManager({ maxRooms: 5, maxPlayersPerRoom: 8 })
    const room = m.create({ id: 'tmp', name: 'tmp' })
    room.join({ id: pid(1), name: 'a', socket: null })
    room.leave(pid(1))
    expect(m.get('tmp')).toBeUndefined()
  })
  it('enforces the room cap and per-room player cap', () => {
    const m = new RoomManager({ maxRooms: 1, maxPlayersPerRoom: 2 })
    const room = m.create({ id: 'a', name: 'a', maxPlayers: 10 })
    expect(room.maxPlayers).toBe(2)
    expect(() => m.create({ id: 'b', name: 'b' })).toThrow('too many rooms')
    room.join({ id: pid(1), name: 'x', socket: null })
    room.join({ id: pid(2), name: 'y', socket: null })
    expect(room.full).toBe(true)
  })
})
