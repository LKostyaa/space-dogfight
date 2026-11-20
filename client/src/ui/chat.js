/** Chat box + roster. Talks to the Connection only through events and send(). */
export function mountChat(root, conn) {
  root.className = 'chat'
  root.innerHTML = `<ul id="chat-log"></ul><input id="chat-input" placeholder="Enter — chat" maxlength="200">`
  const log = root.querySelector('#chat-log')
  const input = root.querySelector('#chat-input')
  const add = (text, cls = '') => {
    const li = document.createElement('li')
    li.textContent = text
    if (cls) li.className = cls
    log.append(li)
    while (log.children.length > 8) log.firstChild.remove()
  }

  conn.addEventListener('chat', (e) => add(`${e.detail.from}: ${e.detail.text}`))
  conn.addEventListener('roster', (e) => add(`in room: ${e.detail.players.map((p) => p.name).join(', ')}`, 'muted'))
  conn.addEventListener('reconnecting', (e) => add(`connection lost, retry in ${(e.detail.delay / 1000).toFixed(1)} s`, 'error'))
  conn.addEventListener('shutdown', () => add('server is restarting…', 'error'))
  conn.addEventListener('close', (e) => e.detail.code >= 4000 && add(`disconnected: ${e.detail.reason}`, 'error'))

  input.addEventListener('keydown', (e) => {
    e.stopPropagation() // typing must not steer the ship
    if (e.key === 'Enter' && input.value.trim()) {
      conn.send({ v: 0, type: 'chat', text: input.value.trim() })
      input.value = ''
      input.blur()
    }
    if (e.key === 'Escape') input.blur()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement !== input) input.focus()
  })
  return { add }
}
