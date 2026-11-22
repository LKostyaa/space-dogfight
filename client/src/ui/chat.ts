import type { Connection } from '../net/connection.ts'

export function mountChat(root: HTMLElement, conn: Connection): { add(text: string, cls?: string): void; destroy(): void } {
  root.className = 'chat'
  const log = document.createElement('ul')
  log.id = 'chat-log'
  const input = document.createElement('input')
  input.id = 'chat-input'
  input.placeholder = 'Enter — chat'
  input.maxLength = 200
  root.replaceChildren(log, input)

  const add = (text: string, cls = ''): void => {
    const li = document.createElement('li')
    li.textContent = text
    if (cls) li.className = cls
    log.append(li)
    while (log.children.length > 8) log.firstElementChild?.remove()
  }

  conn.on('chat', (m) => add(`${m.from}: ${m.text}`))
  conn.on('roster', (m) => add(`in room: ${m.players.map((p) => p.name).join(', ')}`, 'muted'))
  conn.on('reconnecting', (e) => add(`connection lost, retry in ${(e.delay / 1000).toFixed(1)} s`, 'error'))
  conn.on('shutdown', () => add('server is restarting…', 'error'))
  conn.on('close', (e) => {
    if (e.code >= 4000) add(`disconnected: ${e.reason}`, 'error')
  })

  input.addEventListener('keydown', (e) => {
    e.stopPropagation() // typing must not steer the ship
    if (e.key === 'Enter' && input.value.trim()) {
      conn.sendJson({ v: 1, type: 'chat', text: input.value.trim() })
      input.value = ''
      input.blur()
    }
    if (e.key === 'Escape') input.blur()
  })
  const focus = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && document.activeElement !== input) input.focus()
  }
  window.addEventListener('keydown', focus)
  return {
    add,
    destroy() {
      window.removeEventListener('keydown', focus)
      root.replaceChildren()
    },
  }
}
