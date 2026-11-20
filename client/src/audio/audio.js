/**
 * Owns the AudioContext. Browsers start it "suspended" until a user gesture,
 * so we resume it on the first click/key. Buffers are decoded during loading.
 * The simulation never imports this module — it only listens to bus events.
 */
export function createAudio() {
  const ctx = new AudioContext()
  const buffers = new Map()
  const gain = ctx.createGain()
  gain.gain.value = 0.5
  gain.connect(ctx.destination)

  const unlock = () => {
    if (ctx.state === 'suspended') ctx.resume()
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)

  return {
    ctx,
    add(name, buffer) {
      if (buffer) buffers.set(name, buffer)
    },
    play(name) {
      const buffer = buffers.get(name)
      if (!buffer || ctx.state !== 'running') return
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(gain)
      src.start()
    },
    /** Subscribe to the game's event bus. */
    listen(bus, myPlayerId) {
      bus.addEventListener('fired', (e) => e.detail.playerId === myPlayerId() && this.play('shoot'))
      bus.addEventListener('hit', () => this.play('hit'))
      bus.addEventListener('exploded', () => this.play('explosion'))
      bus.addEventListener('pickup', () => this.play('pickup'))
    },
  }
}
