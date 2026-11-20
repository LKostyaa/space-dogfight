import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { ARENA } from '@dogfight/shared/sim/arena.js'
import { DT } from '@dogfight/shared/sim/constants.js'
import { setupCanvas } from './render/canvas.js'
import { beginFrame, endFrame, drawEntity, drawHud } from './render/draw.js'
import { drawLoading } from './render/loading.js'
import { drawNetgraph } from './render/netgraph.js'
import { createSprites } from './render/sprites.js'
import { loadAll, loadSequential, loadImage, loadAudio, loadJson } from './assets/loader.js'
import { createAudio } from './audio/audio.js'
import { createHud } from './ui/hud.js'
import { Lobby } from './ui/lobby.js'
import { mountLobbyView } from './ui/lobby-view.js'
import { Connection, wsUrl } from './net/connection.js'
import { createLagger } from './net/latency.js'
import { NetGame } from './net/netgame.js'
import { mountChat } from './ui/chat.js'

// URL flags:
//   loading tests (Lab 3): ?missing=1 ?slow=ms ?abort=ms ?badjson=1 ?sequential=1
//   netcode (Lab 5): ?codec=json|binary ?lag=ms ?jitter=ms ?drop=% ?interp=ms ?netgraph=0 ?predict=0 ?breakdet=1
const params = new URLSearchParams(location.search)
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
  window.__loadMs = performance.now() - t0
  progress.errors = result.errors
  paint()
  return { manifest, ...result }
}

function startGame({ assets, manifest }, room, name) {
  for (const [k, buf] of Object.entries(assets)) if (k.startsWith('sfx:')) audio.add(k.slice(4), buf)
  const sprites = createSprites(assets.sprites, manifest.sheet)
  const input = createInput(window)
  const codec = params.get('codec') === 'json' ? 'json' : 'binary'
  const lagger = createLagger({ lag: +(params.get('lag') ?? 0), jitter: +(params.get('jitter') ?? 0), drop: +(params.get('drop') ?? 0) })
  let showNetgraph = params.get('netgraph') !== '0'

  const conn = new Connection(wsUrl(), { hello: () => ({ v: 1, type: 'join', room: room.id, name, codec }) })
  const bus = new EventTarget()
  const game = new NetGame({
    conn,
    codec,
    lagger,
    bus,
    interpDelay: +(params.get('interp') ?? 100),
    predict: params.get('predict') !== '0',
    breakDeterminism: params.get('breakdet') === '1',
  })
  mountChat(document.getElementById('chat'), conn)
  const hud = createHud(bus, (id) => game.players.get(id)?.name)
  audio.listen(bus, () => game.myId)
  conn.connect()

  // live netcode controls
  const LAGS = [0, 50, 100, 200]
  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return
    if (e.key === ']') game.interpDelay += 10
    if (e.key === '[') game.interpDelay = Math.max(0, game.interpDelay - 10)
    if (e.code === 'KeyN') showNetgraph = !showNetgraph
    if (e.code === 'KeyL') lagger.settings.lag = LAGS[(LAGS.indexOf(lagger.settings.lag) + 1) % LAGS.length]
    if (e.code === 'KeyJ') lagger.settings.jitter = lagger.settings.jitter ? 0 : 30
    if (e.code === 'KeyD') lagger.settings.drop = lagger.settings.drop ? 0 : 2
  })

  let lastRender = performance.now()
  function simulate() {
    game.step(document.activeElement?.tagName === 'INPUT' ? {} : readControls(input))
    input.endStep()
  }

  function render(alpha, stats) {
    const now = performance.now()
    const dtFrame = Math.min(0.1, (now - lastRender) / 1000)
    lastRender = now
    beginFrame(ctx, view, ARENA)
    for (const e of game.view(alpha, dtFrame)) drawEntity(ctx, e, 1, sprites)
    endFrame(ctx)
    drawHud(ctx, [
      `${room.name} — sim ${stats.stepsPerSecond}/s  frames ${stats.framesPerSecond}/s`,
      `score ${game.myScore}  hp ${game.myShip?.hp ?? '-'}  players ${game.players.size}`,
      ...hud.lines(),
    ])
    if (showNetgraph) drawNetgraph(ctx, view, game, lagger.settings, codec)
  }

  // the client simulates at the server's tick rate (30 Hz); rendering interpolates at display rate
  const loop = createLoop({ step: DT, simulate, render })
  loop.start()
  Object.assign(window, { __loop: loop, __game: game, __conn: conn, __lagger: lagger })
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
