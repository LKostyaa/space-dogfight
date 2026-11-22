export interface LagSettings {
  lag: number
  jitter: number
  drop: number
}

export interface Lagger {
  readonly settings: LagSettings
  delay(fn: () => void): void
}

export function createLagger({ lag = 0, jitter = 0, drop = 0 }: Partial<LagSettings> = {}): Lagger {
  const settings: LagSettings = { lag, jitter, drop }
  return {
    settings,
    delay(fn) {
      if (settings.drop > 0 && Math.random() * 100 < settings.drop) return
      const ms = settings.lag + (Math.random() * 2 - 1) * settings.jitter
      if (ms <= 0) fn()
      else setTimeout(fn, ms)
    },
  }
}
