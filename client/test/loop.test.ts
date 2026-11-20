import { describe, it, expect } from 'vitest'
import { createLoop, frameTimesOf } from '../src/loop.ts'

/** Fake frames: we decide when the "display" refreshes and what timestamp it reports. */
function fakeFrames() {
  let cb: FrameRequestCallback | null = null
  return {
    requestFrame: (f: FrameRequestCallback) => ((cb = f), 1),
    cancelFrame: () => void (cb = null),
    tick(t: number) {
      const f = cb
      cb = null
      f?.(t)
    },
  }
}

describe('fixed-timestep loop', () => {
  it('runs simulate at a fixed rate regardless of the display rate', () => {
    for (const hz of [60, 144]) {
      const frames = fakeFrames()
      let steps = 0
      const loop = createLoop({ step: 1 / 60, simulate: () => steps++, render: () => {}, ...frames })
      loop.start()
      for (let i = 0; i <= hz; i++) frames.tick((i * 1000) / hz) // one second of frames
      expect(steps).toBeGreaterThanOrEqual(59)
      expect(steps).toBeLessThanOrEqual(60)
    }
  })
  it('alpha is the leftover fraction of a step, always in [0, 1)', () => {
    const frames = fakeFrames()
    const alphas: number[] = []
    const loop = createLoop({ step: 1 / 60, simulate: () => {}, render: (a) => alphas.push(a), ...frames })
    loop.start()
    for (let i = 0; i < 50; i++) frames.tick(i * 7) // 7 ms frames: never a whole step
    expect(alphas.every((a) => a >= 0 && a < 1)).toBe(true)
  })
  it('clamps a huge pause (no spiral of death) and records frame times', () => {
    const frames = fakeFrames()
    let steps = 0
    const loop = createLoop({ step: 1 / 60, simulate: () => steps++, render: () => {}, ...frames })
    loop.start()
    frames.tick(0)
    frames.tick(10_000) // 10 s in a background tab
    expect(steps).toBe(15) // clamped to 0.25 s = 15 steps
    expect(frameTimesOf(loop.stats)).toEqual([10_000])
    loop.stop()
  })
})
