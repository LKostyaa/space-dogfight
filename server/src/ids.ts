import { toId, type PlayerId } from '@dogfight/shared/types.ts'

export class PlayerIdPool {
  readonly #used = new Set<number>()
  readonly #max: number

  constructor(max = 254) {
    this.#max = max
  }

  take(): PlayerId | null {
    for (let i = 1; i <= this.#max; i++) {
      if (!this.#used.has(i)) {
        this.#used.add(i)
        return toId<PlayerId>(i)
      }
    }
    return null
  }

  release(id: PlayerId): void {
    this.#used.delete(id)
  }

  get size(): number {
    return this.#used.size
  }
}

export const playerIds = new PlayerIdPool()
