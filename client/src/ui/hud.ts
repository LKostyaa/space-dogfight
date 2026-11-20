import type { Bus } from '@dogfight/shared/sim/world.ts'
import type { ClientEvents } from '../net/netgame.ts'

/** Kill feed. Listens to the bus; the netcode/sim does not know it exists. */
export function createHud(bus: Bus<ClientEvents>, nameOf: (playerId: number) => string | undefined): { lines(): string[] } {
  const feed: { text: string; t: number }[] = []
  const push = (text: string): void => {
    feed.unshift({ text, t: performance.now() })
    feed.length = Math.min(feed.length, 5)
  }
  bus.on('exploded', (e) => {
    if (e.kind === 'ship') push(`${nameOf(e.by) ?? 'asteroid'} destroyed ${nameOf(e.playerId) ?? 'a ship'}`)
  })
  bus.on('pickup', (e) => push(`${nameOf(e.playerId) ?? '?'} picked up ${e.effect}`))

  return {
    lines() {
      const now = performance.now()
      return feed.filter((f) => now - f.t < 5000).map((f) => f.text)
    },
  }
}
