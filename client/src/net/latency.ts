export interface LagSettings {
  lag: number
  jitter: number
  drop: number
}

export interface Lagger {
  readonly settings: LagSettings
  delay(fn: () => void): void
}

/**
 * Latency / jitter / packet-drop injector for testing netcode on localhost.
 * Every message in both directions goes through `delay(fn)`.
 * Settings are live-editable (netgraph keys) and start from the URL:
 *   ?lag=100&jitter=30&drop=2   (ms one way, ± ms, percent)
 * Note: with jitter, messages can arrive out of order — just like UDP. The
 * game handles that (old snapshots and old input seqs are ignored).
 */
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
