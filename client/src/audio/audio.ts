import type { Bus } from '@dogfight/shared/sim/world.ts'
import type { ClientEvents } from '../net/netgame.ts'

export type SoundName = 'shoot' | 'hit' | 'explosion' | 'pickup'

export interface Audio {
  readonly ctx: AudioContext
  add(name: SoundName, buffer: AudioBuffer | null): void
  play(name: SoundName): void
  listen(bus: Bus<ClientEvents>, myPlayerId: () => number): void
}

/**
 * Owns the AudioContext. Browsers start it "suspended" until a user gesture,
 * so we resume it on the first click/key. Buffers are decoded during loading.
 * The simulation never imports this module — it only listens to bus events.
 */
export function createAudio(): Audio {
  const ctx = new AudioContext()
  const buffers = new Map<SoundName, AudioBuffer>()
  const gain = ctx.createGain()
  gain.gain.value = 0.5
  gain.connect(ctx.destination)

  const unlock = (): void => {
    if (ctx.state === 'suspended') void ctx.resume()
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)

  const play = (name: SoundName): void => {
    const buffer = buffers.get(name)
    if (!buffer || ctx.state !== 'running') return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(gain)
    src.start()
  }

  return {
    ctx,
    add(name, buffer) {
      if (buffer) buffers.set(name, buffer)
    },
    play,
    listen(bus, myPlayerId) {
      bus.on('fired', (e) => e.playerId === myPlayerId() && play('shoot'))
      bus.on('hit', () => play('hit'))
      bus.on('exploded', () => play('explosion'))
      bus.on('pickup', () => play('pickup'))
    },
  }
}
