import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLagger } from '../src/net/latency.ts'

describe('latency injector', () => {
  afterEach(() => vi.useRealTimers())

  it('no lag -> delivered synchronously', () => {
    let got = false
    createLagger().delay(() => (got = true))
    expect(got).toBe(true)
  })
  it('100% drop -> never delivered', () => {
    vi.useFakeTimers()
    let got = 0
    const l = createLagger({ drop: 100 })
    for (let i = 0; i < 50; i++) l.delay(() => got++)
    vi.advanceTimersByTime(1000)
    expect(got).toBe(0)
  })
  it('lag delays delivery by the configured time', () => {
    vi.useFakeTimers()
    let got = false
    createLagger({ lag: 100 }).delay(() => (got = true))
    vi.advanceTimersByTime(99)
    expect(got).toBe(false)
    vi.advanceTimersByTime(2)
    expect(got).toBe(true)
  })
})
