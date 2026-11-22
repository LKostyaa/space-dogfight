const ENABLED = new URLSearchParams(location.search).has('perf')
const durations = new Map<string, number[]>()
let calls = 0

export function measure<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn()
  const start = `${name}:start`
  performance.mark(start)
  try {
    return fn()
  } finally {
    const m = performance.measure(name, start)
    let list = durations.get(name)
    if (!list) durations.set(name, (list = []))
    list.push(m.duration)
    if (list.length > 4000) list.shift()
    if (++calls % 500 === 0) {
      performance.clearMarks()
      performance.clearMeasures()
    }
  }
}

const pct = (a: readonly number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
}

export function perfReport(): Record<string, { n: number; p50: number; p99: number; totalMs: number }> {
  const out: Record<string, { n: number; p50: number; p99: number; totalMs: number }> = {}
  for (const [name, list] of durations) out[name] = { n: list.length, p50: pct(list, 0.5), p99: pct(list, 0.99), totalMs: list.reduce((a, b) => a + b, 0) }
  return out
}

export function resetPerf(): void {
  durations.clear()
}
