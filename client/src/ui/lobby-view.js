/** DOM rendering of the Lobby model. Only listens to its events and calls lobby.join(). */
export function mountLobbyView(root, lobby, { warnings = [] } = {}) {
  root.innerHTML = `
    <div class="panel">
      <h1>Space Dogfight</h1>
      <label>Pilot name <input id="pilot" maxlength="16" value="pilot-${Math.floor(Math.random() * 900 + 100)}"></label>
      <h2>Rooms</h2>
      <ul id="rooms"><li class="muted">loading…</li></ul>
      <p id="lobby-error" class="error"></p>
      <ul class="warnings">${warnings.map((w) => `<li class="muted">⚠ ${w}</li>`).join('')}</ul>
    </div>`
  const list = root.querySelector('#rooms')
  const errorEl = root.querySelector('#lobby-error')
  const nameEl = root.querySelector('#pilot')

  const onRooms = (e) => {
    errorEl.textContent = ''
    list.replaceChildren(
      ...e.detail.rooms.map((r) => {
        const li = document.createElement('li')
        const full = r.players >= r.maxPlayers
        li.innerHTML = `<span>${r.name}</span><span class="muted">${r.players}/${r.maxPlayers}</span>`
        const btn = document.createElement('button')
        btn.textContent = full ? 'Full' : 'Join'
        btn.disabled = full
        btn.dataset.room = r.id
        btn.addEventListener('click', () => lobby.join(r.id, nameEl.value.trim() || 'pilot'))
        li.append(btn)
        return li
      }),
    )
  }
  const onError = (e) => (errorEl.textContent = `Could not load rooms: ${e.detail.error.message}. Retrying…`)
  const onJoin = () => {
    root.hidden = true
    lobby.removeEventListener('rooms', onRooms)
    lobby.removeEventListener('error', onError)
  }

  lobby.addEventListener('rooms', onRooms)
  lobby.addEventListener('error', onError)
  lobby.addEventListener('join', onJoin, { once: true })
  root.hidden = false
}
