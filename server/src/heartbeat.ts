/** Something we can ping and, if it stopped answering, cut off. */
export interface Pingable {
  missedPongs: number
  ping(): void
  terminate(): void
}

/**
 * Every `intervalMs`: terminate clients that missed `maxMissed` pongs, ping the rest.
 * A client resets `missedPongs` to 0 when its pong arrives (see ws.ts).
 */
export function startHeartbeat(clients: () => Iterable<Pingable>, { intervalMs = 15000, maxMissed = 2, onDead = (_c: Pingable) => {} } = {}): () => void {
  const timer = setInterval(() => {
    for (const c of clients()) {
      if (c.missedPongs >= maxMissed) {
        onDead(c)
        c.terminate()
        continue
      }
      c.missedPongs++
      c.ping()
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
