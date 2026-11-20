import { z } from 'zod'
import { Bus } from '@dogfight/shared/sim/world.ts'
import { fetchJson } from '../assets/loader.ts'

export const RoomInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  arena: z.string(),
  players: z.number().int(),
  maxPlayers: z.number().int(),
})
export type RoomInfo = z.infer<typeof RoomInfoSchema>

export interface LobbyEvents {
  rooms: { rooms: readonly RoomInfo[] }
  error: { error: unknown; retryInMs: number }
  join: { room: RoomInfo; name: string }
}

/**
 * Lobby model: knows nothing about the DOM. While visible it polls the room
 * list (every `intervalMs`; after failures with exponential backoff up to
 * `maxBackoffMs` — e.g. while the server restarts) and reports through typed
 * events. leave() aborts the in-flight request and stops polling.
 */
export class Lobby extends Bus<LobbyEvents> {
  #controller: AbortController | null = null
  #timer = 0
  #failures = 0
  readonly url: string
  readonly intervalMs: number
  readonly timeoutMs: number
  readonly maxBackoffMs: number
  rooms: RoomInfo[] = []

  constructor({ url = '/api/rooms', intervalMs = 3000, timeoutMs = 2500, maxBackoffMs = 8000 } = {}) {
    super()
    this.url = url
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.maxBackoffMs = maxBackoffMs
  }

  async refresh(): Promise<void> {
    const controller = this.#controller
    if (!controller) return
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    let next = this.intervalMs
    try {
      this.rooms = z.array(RoomInfoSchema).parse(await fetchJson(this.url, { signal }))
      this.#failures = 0
      this.emit('rooms', { rooms: this.rooms })
    } catch (error: unknown) {
      if (controller.signal.aborted) return // we left: not an error
      next = Math.min(this.maxBackoffMs, 500 * 2 ** this.#failures++) * (0.5 + Math.random() / 2)
      this.emit('error', { error, retryInMs: next })
    }
    if (this.#controller === controller) this.#timer = window.setTimeout(() => void this.refresh(), next)
  }

  enter(): void {
    this.leave()
    this.#controller = new AbortController()
    this.#failures = 0
    void this.refresh()
  }

  leave(): void {
    window.clearTimeout(this.#timer)
    this.#controller?.abort(new DOMException('left lobby', 'AbortError'))
    this.#controller = null
  }

  join(roomId: string, name: string): void {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room) return
    this.leave()
    this.emit('join', { room, name })
  }
}
