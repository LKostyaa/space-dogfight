import { describe, it, expect } from 'vitest'
import { createTokenBucket } from '../src/ratelimit.ts'

describe('token bucket', () => {
  it('allows a burst, then says no', () => {
    const b = createTokenBucket({ rate: 10, burst: 3, now: () => 0 })
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false])
  })
  it('refills at `rate` tokens per second', () => {
    let now = 0
    const b = createTokenBucket({ rate: 10, burst: 3, now: () => now })
    for (let i = 0; i < 3; i++) b.take()
    now += 100 // 0.1 s -> 1 token
    expect(b.take()).toBe(true)
    expect(b.take()).toBe(false)
  })
  it('never saves more than `burst`', () => {
    let now = 0
    const b = createTokenBucket({ rate: 10, burst: 3, now: () => now })
    now += 60_000
    expect(b.tokens).toBeLessThanOrEqual(3)
    b.take()
    expect(b.tokens).toBeCloseTo(2, 5)
  })
})
