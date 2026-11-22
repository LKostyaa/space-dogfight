export interface Pingable {
  missedPongs: number
  ping(): void
  terminate(): void
}

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
