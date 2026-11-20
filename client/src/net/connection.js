/**
 * WebSocket wrapper:
 *  - dispatches incoming messages by `type` as events on itself (EventTarget)
 *  - queues outgoing messages while (re)connecting
 *  - reconnects with exponential backoff + jitter, unless closed on purpose
 *    or the server said "don't come back" (4000-range codes except 1001/1006)
 */
const RETRYABLE = new Set([1001, 1006, 1011, 1012, 1013])

export class Connection extends EventTarget {
  #ws = null
  #queue = []
  #attempt = 0
  #timer = 0
  #closedByUs = false

  constructor(url, { hello, maxDelayMs = 8000 } = {}) {
    super()
    this.url = url
    this.hello = hello // message sent on every (re)connect, e.g. join
    this.maxDelayMs = maxDelayMs
    this.state = 'idle'
  }

  connect() {
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
      this.dispatchEvent(new Event('open'))
    })
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') {
        this.dispatchEvent(new CustomEvent('binary', { detail: e.data }))
        return
      }
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }))
    })
    ws.addEventListener('close', (e) => {
      this.state = 'closed'
      this.dispatchEvent(new CustomEvent('close', { detail: { code: e.code, reason: e.reason } }))
      if (this.#closedByUs || !RETRYABLE.has(e.code)) return
      const delay = Math.min(this.maxDelayMs, 250 * 2 ** this.#attempt++) * (0.5 + Math.random() / 2)
      this.state = 'reconnecting'
      this.dispatchEvent(new CustomEvent('reconnecting', { detail: { delay, attempt: this.#attempt } }))
      this.#timer = setTimeout(() => this.connect(), delay)
    })
  }

  send(msg) {
    const data = typeof msg === 'string' || msg instanceof ArrayBuffer ? msg : JSON.stringify(msg)
    if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(data)
    else if (typeof data === 'string') this.#queue.push(data) // inputs (binary) are not worth queueing
  }

  get bufferedAmount() {
    return this.#ws?.bufferedAmount ?? 0
  }

  close() {
    this.#closedByUs = true
    clearTimeout(this.#timer)
    this.#ws?.close(1000, 'bye')
  }
}

export function wsUrl(path = '/ws') {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}
