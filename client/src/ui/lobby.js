import { fetchJson } from '../assets/loader.js'

/**
 * Lobby model: knows nothing about the DOM. It fetches the room list on an
 * interval while visible and reports through events:
 *   "rooms" {rooms}, "error" {error}, "join" {room, name}
 * leave() aborts the in-flight request and stops polling — no orphaned fetches.
 */
export class Lobby extends EventTarget {
  #controller = null
  #timer = 0

  constructor({ url = '/api/rooms', intervalMs = 3000, timeoutMs = 2500 } = {}) {
    super()
    this.url = url
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
    this.rooms = []
  }

  async refresh() {
    if (!this.#controller) return
    const signal = AbortSignal.any([this.#controller.signal, AbortSignal.timeout(this.timeoutMs)])
    try {
      this.rooms = await fetchJson(this.url, { signal })
      this.dispatchEvent(new CustomEvent('rooms', { detail: { rooms: this.rooms } }))
    } catch (error) {
      if (this.#controller?.signal.aborted) return // we left: not an error
      this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
    }
  }

  enter() {
    this.#controller = new AbortController()
    this.refresh()
    this.#timer = setInterval(() => this.refresh(), this.intervalMs)
  }

  leave() {
    clearInterval(this.#timer)
    this.#controller?.abort(new DOMException('left lobby', 'AbortError'))
    this.#controller = null
  }

  join(roomId, name) {
    const room = this.rooms.find((r) => r.id === roomId)
    if (!room) return
    this.leave()
    this.dispatchEvent(new CustomEvent('join', { detail: { room, name } }))
  }
}
