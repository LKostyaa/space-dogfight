import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { ARENA } from './sim/arena.js'
import { World } from './sim/world.js'
import { Ship } from './sim/ship.js'
import { Vector2 } from './sim/vector.js'
import { setupCanvas } from './render/canvas.js'
import { beginFrame, endFrame, drawEntity, drawHud } from './render/draw.js'
import { drawLoading } from './render/loading.js'
import { createSprites } from './render/sprites.js'
import { loadAll, loadSequential, loadImage, loadAudio, loadJson } from './assets/loader.js'
import { createAudio } from './audio/audio.js'
import { createHud } from './ui/hud.js'
import { Lobby } from './ui/lobby.js'
import { mountLobbyView } from './ui/lobby-view.js'
import { Connection, wsUrl } from './net/connection.js'
import { mountChat } from './ui/chat.js'

// Test flags (README "Галерея збоїв"):
//   ?missing=1    add a sprite that does not exist (404)
//   ?slow=ms      every sound is served with a delay (needs the dev-server delay middleware)
//   ?abort=ms     abort loading after ms
//   ?badjson=1    load an arena with corrupt JSON
//   ?sequential=1 load one by one instead of Promise.all (timing comparison)
//   ?exp=...      Lab 1 loop experiments
const params = new URLSearchParams(location.search)
const exp = params.get('exp')
const slow = params.get('slow')
const withDelay = (url) => (slow ? `${url}?delay=${slow}` : url)

const { ctx, view } = setupCanvas(document.getElementById('game'))
const retryBtn = document.getElementById('retry')
const audio = createAudio()

async function loadAssets() {
  const progress = { done: 0, total: 1, errors: [] }
  const controller = new AbortController()
  if (params.get('abort')) setTimeout(() => controller.abort(new DOMException('Loading aborted', 'AbortError')), +params.get('abort'))
  const paint = () => drawLoading(ctx, view, progress)
  paint()

  const manifest = await loadJson('/assets/manifest.json', { signal: controller.signal })
  const items = [
    { key: 'sprites', load: (o) => loadImage(manifest.images.sprites, o), required: false },
    ...Object.entries(manifest.sounds).map(([k, url]) => ({
      key: `sfx:${k}`,
      load: (o) => loadAudio(audio.ctx, withDelay(url), o),
      required: false,
    })),
    ...Object.entries(manifest.arenas).map(([k, url]) => ({ key: `arena:${k}`, load: (o) => loadJson(url, o), required: false })),
  ]
  if (params.get('missing')) items.push({ key: 'sprites:extra', load: (o) => loadImage('/assets/nope.svg', o), required: false })
  if (params.get('badjson')) items.push({ key: 'arena:corrupt', load: (o) => loadJson('/assets/arenas/corrupt.json', o), required: false })
  progress.total = items.length

  const t0 = performance.now()
  const load = params.get('sequential') ? loadSequential : loadAll
  const result = await load(items, {
    signal: controller.signal,
    onProgress: (p) => {
      progress.done = p.done
      paint()
    },
  })
  const ms = performance.now() - t0
  console.log(`assets loaded in ${ms.toFixed(0)} ms (${params.get('sequential') ? 'sequential' : 'Promise.all'})`)
  window.__loadMs = ms
  progress.errors = result.errors
  paint()
  return { manifest, ...result }
}

function startGame({ assets, manifest }, room, name) {
  // Lab 4: the room is real (roster + chat over WebSocket); the match itself is still local until Lab 5.
  const conn = new Connection(wsUrl(), { hello: () => ({ v: 0, type: 'join', room: room.id, name }) })
  mountChat(document.getElementById('chat'), conn)
  conn.connect()
  window.__conn = conn
  const arena = assets[`arena:${room.arena}`] ?? { asteroids: 5, pickups: 3, seed: 1 }
  for (const [k, buf] of Object.entries(assets)) if (k.startsWith('sfx:')) audio.add(k.slice(4), buf)
  const sprites = createSprites(assets.sprites, manifest.sheet)
  const input = createInput(window)

  const world = new World({ seed: arena.seed })
  const me = world.spawn(new Ship({ pos: new Vector2(400, 450), angle: 0, playerId: 1, name }))
  const dummy = world.spawn(
    new Ship({ pos: new Vector2(1200, 450), angle: Math.PI, playerId: 2, name: 'dummy', color: '#ff8a65' }),
  )
  world.populate({ asteroids: arena.asteroids, pickups: arena.pickups })

  const names = new Map([
    [1, name],
    [2, 'dummy'],
  ])
  const hud = createHud(world.bus, (id) => names.get(id))
  audio.listen(world.bus, () => me.id)

  function simulate(dt) {
    world.step(
      dt,
      new Map([
        [me.playerId, readControls(input)],
        [dummy.playerId, { left: true, right: false, thrust: true, fire: false }],
      ]),
    )
    input.endStep()
  }

  function render(alpha, stats) {
    beginFrame(ctx, view, ARENA)
    for (const e of world) drawEntity(ctx, e, alpha, sprites)
    endFrame(ctx)
    drawHud(ctx, [
      `${room.name} — steps/s ${stats.stepsPerSecond} frames/s ${stats.framesPerSecond}`,
      `frame ${stats.frameTimeMs.toFixed(1)} ms  entities ${world.size}`,
      `score ${me.score}  hp ${me.hp}`,
      ...hud.lines(),
    ])
  }

  const loop = createLoop({
    step: 1 / 60,
    simulate,
    render,
    scheduler: exp === 'interval' ? 'interval' : 'raf',
    fixed: exp !== 'variable',
  })
  loop.start()
  window.__loop = loop
  window.__world = world
}

async function boot() {
  retryBtn.hidden = true
  let loaded
  try {
    loaded = await loadAssets()
  } catch (error) {
    console.error(error)
    drawLoading(ctx, view, { done: 0, total: 1, fatal: error })
    retryBtn.hidden = false
    return
  }
  const lobby = new Lobby()
  lobby.addEventListener('join', (e) => startGame(loaded, e.detail.room, e.detail.name), { once: true })
  mountLobbyView(document.getElementById('lobby'), lobby, {
    warnings: loaded.errors.map((e) => `${e.key}: ${e.error.message} — fallback used`),
  })
  lobby.enter()
  window.__lobby = lobby
}

retryBtn.addEventListener('click', boot)
boot()
