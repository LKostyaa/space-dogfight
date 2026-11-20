import { Bus } from '@dogfight/shared/sim/world.ts'
import { parseServerMessage, type ServerMessage, type ClientMessageSchema } from '@dogfight/shared/protocol.ts'
import { assertNever } from '@dogfight/shared/types.ts'
import type { Wire } from '@dogfight/shared/codec/index.ts'
import type { z } from 'zod'

type ByType<T extends { type: string }> = { [K in T['type']]: Extract<T, { type: K }> }

/** Everything a Connection can tell you: parsed server messages plus lifecycle events. */
export type ConnectionEvents = ByType<ServerMessage> & {
  open: Record<string, never>
  close: { code: number; reason: string }
  reconnecting: { delay: number; attempt: number }
  binary: ArrayBuffer
  /** JSON-codec snapshot, passed raw to the codec */
  snapshot: string
}

/** Client messages are inputs to the same schema the server validates with. */
export type OutgoingJson = z.input<typeof ClientMessageSchema>

const RETRYABLE = new Set([1001, 1006, 1011, 1012, 1013])

/**
 * WebSocket wrapper:
 *  - parses incoming JSON with the shared zod schema and emits it by `type`
 *  - queues outgoing messages while (re)connecting
 *  - reconnects with exponential backoff + jitter, unless closed on purpose
 *    or the server said "don't come back" (4000-range codes)
 */
export class Connection extends Bus<ConnectionEvents> {
  #ws: WebSocket | null = null
  #queue: string[] = []
  #attempt = 0
  #timer = 0
  #closedByUs = false
  readonly url: string
  readonly hello: (() => OutgoingJson) | null
  readonly maxDelayMs: number
  state: 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting' = 'idle'

  constructor(url: string, { hello = null, maxDelayMs = 8000 }: { hello?: (() => OutgoingJson) | null; maxDelayMs?: number } = {}) {
    super()
    this.url = url
    this.hello = hello
    this.maxDelayMs = maxDelayMs
  }

  connect(): void {
    this.#closedByUs = false
    this.state = 'connecting'
    const ws = new WebSocket(this.url)
    this.#ws = ws
    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', () => {
      this.#attempt = 0
      this.state = 'open'
      if (this.hello) ws.send(JSON.stringify(this.hello()))
      for (const m of this.#queue.splice(0)) ws.send(m)
      this.emit('open', {})
    })
    ws.addEventListener('message', (e: MessageEvent<unknown>) => this.#onMessage(e.data))
    ws.addEventListener('close', (e) => {
      this.state = 'closed'
      this.emit('close', { code: e.code, reason: e.reason })
      if (this.#closedByUs || !RETRYABLE.has(e.code)) return
      const delay = Math.min(this.maxDelayMs, 250 * 2 ** this.#attempt++) * (0.5 + Math.random() / 2)
      this.state = 'reconnecting'
      this.emit('reconnecting', { delay, attempt: this.#attempt })
      this.#timer = window.setTimeout(() => this.connect(), delay)
    })
  }

  #onMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) return this.emit('binary', data)
    if (typeof data !== 'string') return
    if (data.startsWith('{"v":1,"type":"snapshot"')) return this.emit('snapshot', data) // hot path: the codec parses it
    let raw: unknown
    try {
      raw = JSON.parse(data)
    } catch {
      return
    }
    const r = parseServerMessage(raw)
    if (!r.ok) return console.warn('bad server message', r.error)
    const msg = r.value
    switch (msg.type) {
      case 'welcome':
        return this.emit('welcome', msg)
      case 'roster':
        return this.emit('roster', msg)
      case 'chat':
        return this.emit('chat', msg)
      case 'pong':
        return this.emit('pong', msg)
      case 'shutdown':
        return this.emit('shutdown', msg)
      default:
        return assertNever(msg, 'server message')
    }
  }

  /** Raw frame (codec output). Inputs are not worth queueing while disconnected. */
  send(data: Wire): void {
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(data)
    else if (typeof data === 'string') this.#queue.push(data)
  }

  sendJson(msg: OutgoingJson): void {
    this.send(JSON.stringify(msg))
  }

  get bufferedAmount(): number {
    return this.#ws?.bufferedAmount ?? 0
  }

  close(): void {
    this.#closedByUs = true
    window.clearTimeout(this.#timer)
    this.#ws?.close(1000, 'bye')
  }
}

export function wsUrl(path = '/ws'): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}
