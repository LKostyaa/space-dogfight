import { describe, it, expect } from 'vitest'
import { toId, type PlayerId, type Seq } from '@dogfight/shared/types.ts'
import { Buttons } from '@dogfight/shared/protocol.ts'
import { createRng } from '@dogfight/shared/sim/rng.ts'
import { Room } from '../src/rooms.ts'
import { Match } from '../src/match.ts'
import { Bot } from '../src/bot.ts'

const pid = (n: number): PlayerId => toId<PlayerId>(n)
const seq = (n: number): Seq => toId<Seq>(n)
const make = () => {
  const m = new Match(new Room({ id: 't', name: 't' }), { seed: 1, asteroids: 0, pickups: 0 })
  m.stop() // drive ticks by hand
  return m
}

describe('Match (authoritative tick)', () => {
  it('ignores duplicate and old input seqs', () => {
    const m = make()
    const p = m.addPlayer({ id: pid(1), name: 'a' })
    m.stop()
    m.queueInput(pid(1), { seq: seq(2), bits: 0 })
    m.queueInput(pid(1), { seq: seq(2), bits: 0 })
    m.queueInput(pid(1), { seq: seq(1), bits: 0 })
    expect(p.queue.map((q) => q.seq)).toEqual([2])
  })
  it('applies at most 3 inputs per tick and acks the last applied one', () => {
    const m = make()
    const p = m.addPlayer({ id: pid(1), name: 'a' })
    m.stop()
    for (let i = 1; i <= 5; i++) m.queueInput(pid(1), { seq: seq(i), bits: Buttons.THRUST })
    m.step()
    expect(p.lastSeq).toBe(3)
    m.step()
    expect(p.lastSeq).toBe(5)
  })
  it('a ship does not move on a tick without input (no unpredicted steps)', () => {
    const m = make()
    const p = m.addPlayer({ id: pid(1), name: 'a' })
    m.stop()
    m.queueInput(pid(1), { seq: seq(1), bits: Buttons.THRUST })
    m.step()
    const x = p.ship.pos.x
    m.step()
    expect(p.ship.pos.x).toBe(x)
  })
  it('keeps only the newest 8 inputs when a client floods', () => {
    const m = make()
    const p = m.addPlayer({ id: pid(1), name: 'a' })
    m.stop()
    for (let i = 1; i <= 20; i++) m.queueInput(pid(1), { seq: seq(i), bits: 0 })
    expect(p.queue).toHaveLength(8)
    expect(p.queue[0]?.seq).toBe(13)
  })
  it('bots feed inputs through the same path as humans', () => {
    const m = make()
    const human = m.addPlayer({ id: pid(1), name: 'a' })
    const bot = m.addPlayer({ id: pid(2), name: 'bot', ai: new Bot(createRng(2)) })
    m.stop()
    for (let i = 0; i < 30; i++) m.step()
    expect(bot.lastSeq).toBe(30)
    expect(human.lastSeq).toBe(0)
    expect(m.removeBots()).toEqual([2])
    expect(m.players.size).toBe(1)
  })
  it('removing the last player stops the tick loop', () => {
    const m = new Match(new Room({ id: 't', name: 't' }), { asteroids: 0, pickups: 0 })
    m.addPlayer({ id: pid(1), name: 'a' })
    expect(m.running).toBe(true)
    m.removePlayer(pid(1))
    expect(m.running).toBe(false)
  })
})
