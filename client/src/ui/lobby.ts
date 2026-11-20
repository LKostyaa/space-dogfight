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
  error: { error: unknown }
  join: { room: RoomInfo; name: string }
}

/**
 * Lobby model: knows nothing about the DOM. It fetches the room list on an
 * interval while visible and reports through typed events (rooms / error / join).
 * leave() aborts the in-flight request and stops polling — no orphaned fetches.
 */
export class Lobby extends Bus<LobbyEvents> {
  #controller: AbortController | null = null
  #timer = 0
  readonly url: string
  readonly intervalMs: number
  readonly timeoutMs: number
  rooms: RoomInfo[] = []

  constructor({ url = '/api/rooms', intervalMs = 3000, timeoutMs = 2500 } = {}) {
    super()
    this.url = url
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
  }

  async refresh(): Promise<void> {
    if (!this.#controller) return
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.timeoutMs)])
    try {
      this.rooms = z.array(RoomInfoSchema).parse(await fetchJson(this.url, { signal }))
      this.emit('rooms', { rooms: this.rooms })
    } catch (error: unknown) {
      if (this.#controller?.signal.aborted) return // we left: not an error
      this.emit('error', { error })
    }
  }

  enter(): void {
    this.#controller = new AbortController()
    void this.refresh()
    this.#timer = window.setInterval(() => void this.refresh(), this.intervalMs)
  }

  leave(): void {
    window.clearInterval(this.#timer)
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
