import type { Lobby } from './lobby.ts'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

/** DOM rendering of the Lobby model. Only listens to its events and calls lobby.join(). */
export function mountLobbyView(root: HTMLElement, lobby: Lobby, { warnings = [] }: { warnings?: readonly string[] } = {}): void {
  const nameEl = el('input', { id: 'pilot', maxLength: 16, value: `pilot-${Math.floor(Math.random() * 900 + 100)}` })
  const list = el('ul', { id: 'rooms' }, el('li', { className: 'muted' }, 'loading…'))
  const errorEl = el('p', { id: 'lobby-error', className: 'error' })
  const warnEl = el('ul', { className: 'warnings' }, ...warnings.map((w) => el('li', { className: 'muted' }, `⚠ ${w}`)))
  root.replaceChildren(el('div', { className: 'panel' }, el('h1', {}, 'Space Dogfight'), el('label', {}, 'Pilot name ', nameEl), el('h2', {}, 'Rooms'), list, errorEl, warnEl))

  const offRooms = lobby.on('rooms', ({ rooms }) => {
    errorEl.textContent = ''
    list.replaceChildren(
      ...rooms.map((r) => {
        const full = r.players >= r.maxPlayers
        const btn = el('button', { textContent: full ? 'Full' : 'Join', disabled: full })
        btn.dataset.room = r.id
        btn.addEventListener('click', () => lobby.join(r.id, nameEl.value.trim() || 'pilot'))
        return el('li', {}, el('span', {}, r.name), el('span', { className: 'muted' }, `${r.players}/${r.maxPlayers}`), btn)
      }),
    )
  })
  const offError = lobby.on('error', ({ error }) => {
    errorEl.textContent = `Could not load rooms: ${error instanceof Error ? error.message : String(error)}. Retrying…`
  })
  const offJoin = lobby.on('join', () => {
    root.hidden = true
    offRooms()
    offError()
    offJoin()
  })
  root.hidden = false
}
