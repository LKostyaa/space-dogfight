/**
 * Fixed-timestep game loop on top of requestAnimationFrame.
 *
 * The browser calls `frame` once per display refresh. We add the real elapsed
 * time to an accumulator and run `simulate(step)` as many times as fits, so the
 * simulation always advances in equal slices regardless of the monitor
 * (60 Hz, 144 Hz) or a slow frame. The remainder becomes `alpha` (0..1) which
 * the renderer uses to interpolate between the previous and current state.
 *
 * The elapsed time is clamped (MAX_FRAME) — after a long pause (background tab,
 * debugger) we would otherwise try to run hundreds of steps at once: the
 * "spiral of death".
 *
 * Options used only by the Lab 1 experiments (see README):
 *   scheduler: 'raf' | 'interval'  — setInterval(frame, 16) instead of rAF
 *   fixed: false                   — variable timestep: simulate(dt) once per frame
 */
const MAX_FRAME = 0.25

export interface LoopStats {
  stepsPerSecond: number
  framesPerSecond: number
  frameTimeMs: number
  readonly frameTimes: number[]
}

export interface LoopOptions {
  step?: number
  simulate: (dt: number) => void
  render: (alpha: number, stats: LoopStats) => void
  scheduler?: 'raf' | 'interval'
  fixed?: boolean
}

export interface Loop {
  start(): void
  stop(): void
  readonly stats: LoopStats
}

export function createLoop({ step = 1 / 60, simulate, render, scheduler = 'raf', fixed = true }: LoopOptions): Loop {
  let handle = 0
  let running = false
  let last = 0
  let acc = 0

  const stats: LoopStats = { stepsPerSecond: 0, framesPerSecond: 0, frameTimeMs: 0, frameTimes: [] }
  let stepCount = 0
  let frameCount = 0
  let windowStart = 0

  const schedule =
    scheduler === 'interval'
      ? {
          start: (fn: FrameRequestCallback) => window.setInterval(() => fn(performance.now()), 16),
          next: (_fn: FrameRequestCallback) => {},
          stop: (h: number) => window.clearInterval(h),
        }
      : {
          start: (fn: FrameRequestCallback) => requestAnimationFrame(fn),
          next: (fn: FrameRequestCallback) => (handle = requestAnimationFrame(fn)),
          stop: (h: number) => cancelAnimationFrame(h),
        }

  function frame(t: number): void {
    if (!running) return
    const raw = last === 0 ? 0 : t - last
    const dt = Math.min(raw / 1000, MAX_FRAME)
    stats.frameTimeMs = raw
    if (raw > 0) {
      stats.frameTimes.push(raw)
      if (stats.frameTimes.length > 600) stats.frameTimes.shift()
    }
    last = t

    if (fixed) {
      acc += dt
      while (acc >= step) {
        simulate(step)
        acc -= step
        stepCount++
      }
      render(acc / step, stats)
    } else {
      if (dt > 0) {
        simulate(dt)
        stepCount++
      }
      render(1, stats)
    }
    frameCount++

    if (t - windowStart >= 1000) {
      const secs = (t - windowStart) / 1000
      stats.stepsPerSecond = Math.round(stepCount / secs)
      stats.framesPerSecond = Math.round(frameCount / secs)
      stepCount = 0
      frameCount = 0
      windowStart = t
    }
    schedule.next(frame)
  }

  return {
    start() {
      if (running) return
      running = true
      last = 0
      acc = 0
      windowStart = performance.now()
      handle = schedule.start(frame)
    },
    stop() {
      running = false
      schedule.stop(handle)
    },
    stats,
  }
}
