/** Kill feed + score flash. Listens to the bus; the sim does not know it exists. */
export function createHud(bus, nameOf) {
  const feed = []
  const push = (text) => {
    feed.unshift({ text, t: performance.now() })
    feed.length = Math.min(feed.length, 5)
  }
  bus.addEventListener('exploded', (e) => {
    const { kind, by } = e.detail
    if (kind === 'ship') push(`${nameOf(by) ?? 'asteroid'} destroyed ${nameOf(e.detail.playerId) ?? 'a ship'}`)
  })
  bus.addEventListener('pickup', (e) => push(`${nameOf(e.detail.playerId)} picked up ${e.detail.effect}`))

  return {
    lines() {
      const now = performance.now()
      return feed.filter((f) => now - f.t < 5000).map((f) => f.text)
    },
  }
}
