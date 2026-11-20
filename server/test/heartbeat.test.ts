import { describe, it, expect, vi, afterEach } from 'vitest'
import { startHeartbeat, type Pingable } from '../src/heartbeat.ts'

const client = (): Pingable & { pings: number; dead: boolean } => {
  const c = { missedPongs: 0, pings: 0, dead: false, ping: () => void c.pings++, terminate: () => void (c.dead = true) }
  return c
}

describe('heartbeat (fake timers)', () => {
  afterEach(() => vi.useRealTimers())

  it('pings every interval and keeps clients that answer', () => {
    vi.useFakeTimers()
    const c = client()
    const stop = startHeartbeat(() => [c], { intervalMs: 15000 })
    vi.advanceTimersByTime(15000)
    c.missedPongs = 0 // pong arrived
    vi.advanceTimersByTime(15000)
    c.missedPongs = 0
    vi.advanceTimersByTime(15000)
    expect(c.pings).toBe(3)
    expect(c.dead).toBe(false)
    stop()
  })

  it('terminates a client after two missed pongs', () => {
    vi.useFakeTimers()
    const c = client()
    let reported = 0
    const stop = startHeartbeat(() => [c], { intervalMs: 15000, onDead: () => reported++ })
    vi.advanceTimersByTime(15000 * 3)
    expect(c.dead).toBe(true)
    expect(reported).toBe(1)
    stop()
  })
})
