import { z } from 'zod'
import { ARENA } from '@dogfight/shared/sim/arena.ts'
import { DT } from '@dogfight/shared/sim/constants.ts'
import { Bus } from '@dogfight/shared/sim/world.ts'
import { createLoop } from './loop.ts'
import { createInput, readControls } from './input.ts'
import { setupCanvas } from './render/canvas.ts'
import { beginFrame, endFrame, drawEntity, drawHud } from './render/draw.ts'
import { drawLoading, type LoadingState } from './render/loading.ts'
import { drawNetgraph } from './render/netgraph.ts'
import { createSprites, type SpriteFrame } from './render/sprites.ts'
import { loadAll, loadSequential, loadImage, loadAudio, loadJson, fetchJson, type LoadItem, type LoadResult } from './assets/loader.ts'
import { createAudio, type SoundName } from './audio/audio.ts'
import { createHud } from './ui/hud.ts'
import { Lobby, type RoomInfo } from './ui/lobby.ts'
import { mountLobbyView } from './ui/lobby-view.ts'
import { Connection, wsUrl } from './net/connection.ts'
import { createLagger } from './net/latency.ts'
import { NetGame, type ClientEvents } from './net/netgame.ts'
import { mountChat } from './ui/chat.ts'
import { mountTouchControls } from './ui/touch.ts'
import { measure, perfReport, resetPerf } from './perf.ts'

const params = new URLSearchParams(location.search)
const num = (key: string, def: number): number => Number(params.get(key) ?? def)
const slow = params.get('slow')
const withDelay = (url: string): string => (slow ? `${url}?delay=${slow}` : url)

const SOUNDS: readonly SoundName[] = ['shoot', 'hit', 'explosion', 'pickup']
const ManifestSchema = z.object({
  images: z.object({ sprites: z.string() }),
  sounds: z.record(z.enum(['shoot', 'hit', 'explosion', 'pickup']), z.string()),
  arenas: z.record(z.string(), z.string()),
  sheet: z.object({
    cell: z.number(),
    frames: z.object({ ship: z.number(), shipAlt: z.number(), asteroid: z.number(), bullet: z.number(), shield: z.number(), rapid: z.number(), homing: z.number() } satisfies Record<SpriteFrame, z.ZodNumber>),
  }),
})
type Manifest = z.infer<typeof ManifestSchema>

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id)
  if (!(el instanceof type)) throw new Error(`#${id} is missing`)
  return el
}

const { ctx, view } = setupCanvas(byId('game', HTMLCanvasElement))
const retryBtn = byId('retry', HTMLButtonElement)
const audio = createAudio()

async function loadAssets(): Promise<LoadResult & { manifest: Manifest }> {
  const progress: LoadingState = { done: 0, total: 1, errors: [] }
  const controller = new AbortController()
  const abortAfter = params.get('abort')
  if (abortAfter) setTimeout(() => controller.abort(new DOMException('Loading aborted', 'AbortError')), Number(abortAfter))
  const paint = (): void => drawLoading(ctx, view, progress)
  paint()

  const manifest = ManifestSchema.parse(await loadJson('/assets/manifest.json', { signal: controller.signal }))
  const items: LoadItem[] = [
    { key: 'sprites', load: (o) => loadImage(manifest.images.sprites, o), required: false },
    ...Object.entries(manifest.sounds).map(([k, url]): LoadItem => ({ key: `sfx:${k}`, load: (o) => loadAudio(audio.ctx, withDelay(url), o), required: false })),
    ...Object.entries(manifest.arenas).map(([k, url]): LoadItem => ({ key: `arena:${k}`, load: (o) => loadJson(url, o), required: false })),
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
  Object.assign(window, { __loadMs: performance.now() - t0 })
  progress.errors = result.errors
  paint()
  return { ...result, manifest }
}

let serverVersion = '?'
const HealthSchema = z.object({ version: z.string() })

function startGame({ assets, manifest }: LoadResult & { manifest: Manifest }, room: RoomInfo, name: string, onLeave: (notice: string) => void): void {
  for (const s of SOUNDS) {
    const buf = assets.get(`sfx:${s}`)
    audio.add(s, buf instanceof AudioBuffer ? buf : null)
  }
  const img = assets.get('sprites')
  const sprites = createSprites(img instanceof HTMLImageElement ? img : null, manifest.sheet)
  const input = createInput(window)
  const unmountTouch = mountTouchControls(input)
  const codec = params.get('codec') === 'json' ? 'json' : 'binary'
  const lagger = createLagger({ lag: num('lag', 0), jitter: num('jitter', 0), drop: num('drop', 0) })
  let showNetgraph = params.get('netgraph') !== '0'

  const conn = new Connection(wsUrl(), { hello: () => ({ v: 1, type: 'join', room: room.id, name, codec }) })
  const bus = new Bus<ClientEvents>()
  const game = new NetGame({
    conn,
    codec,
    lagger,
    bus,
    interpDelay: num('interp', 100),
    predict: params.get('predict') !== '0',
    breakDeterminism: params.get('breakdet') === '1',
  })
  const chat = mountChat(byId('chat', HTMLDivElement), conn)
  const hud = createHud(bus, (id) => game.players.get(id)?.name)
  audio.listen(bus, () => game.myId)
  conn.connect()

  // live netcode controls
  const LAGS = [0, 50, 100, 200]
  const onKey = (e: KeyboardEvent): void => {
    if (document.activeElement instanceof HTMLInputElement) return
    if (e.key === ']') game.interpDelay += 10
    if (e.key === '[') game.interpDelay = Math.max(0, game.interpDelay - 10)
    if (e.code === 'KeyN') showNetgraph = !showNetgraph
    if (e.code === 'KeyL') lagger.settings.lag = LAGS[(LAGS.indexOf(lagger.settings.lag) + 1) % LAGS.length] ?? 0
    if (e.code === 'KeyJ') lagger.settings.jitter = lagger.settings.jitter ? 0 : 30
    if (e.code === 'KeyD') lagger.settings.drop = lagger.settings.drop ? 0 : 2
  }
  window.addEventListener('keydown', onKey)

  const IDLE = { left: false, right: false, thrust: false, fire: false }
  let lastRender = performance.now()
  const loop = createLoop({
    step: DT,
    simulate() {
      measure('simulate', () => game.step(document.activeElement instanceof HTMLInputElement ? IDLE : readControls(input)))
      input.endStep()
    },
    render(alpha, stats) {
      const now = performance.now()
      const dtFrame = Math.min(0.1, (now - lastRender) / 1000)
      lastRender = now
      const entities = measure('interpolate', () => game.view(alpha, dtFrame))
      measure('render', () => {
        beginFrame(ctx, view, ARENA)
        for (const e of entities) drawEntity(ctx, e, 1, sprites)
        endFrame(ctx)
      })
      drawHud(ctx, [
        `${room.name} — sim ${stats.stepsPerSecond}/s  frames ${stats.framesPerSecond}/s`,
        `score ${game.myScore}  hp ${game.myShip?.hp ?? '-'}  players ${game.players.size}  v${serverVersion}`,
        ...hud.lines(),
      ])
      if (showNetgraph) drawNetgraph(ctx, view, game, lagger.settings, codec)
    },
  })
  loop.start()
  Object.assign(window, { __loop: loop, __game: game, __conn: conn, __lagger: lagger, __perf: { report: perfReport, reset: resetPerf } })

  let left = false
  const leave = (notice: string): void => {
    if (left) return
    left = true
    loop.stop()
    conn.close()
    game.destroy()
    input.destroy()
    unmountTouch()
    chat.destroy()
    window.removeEventListener('keydown', onKey)
    onLeave(notice)
  }
  conn.on('shutdown', () => leave('The server is restarting (new version). Pick a room to jump back in.'))
  conn.on('close', ({ code, reason }) => {
    if (code === 1000) return
    leave(code >= 4000 ? `Disconnected by the server: ${reason || code}.` : 'Connection lost. Pick a room to rejoin when the server is back.')
  })
}

async function boot(): Promise<void> {
  retryBtn.hidden = true
  let loaded: Awaited<ReturnType<typeof loadAssets>>
  try {
    loaded = await loadAssets()
  } catch (error: unknown) {
    console.error(error)
    drawLoading(ctx, view, { done: 0, total: 1, fatal: error })
    retryBtn.hidden = false
    return
  }
  fetchJson('/health')
    .then((h) => (serverVersion = HealthSchema.parse(h).version))
    .catch(() => {})
  const lobby = new Lobby()
  const showLobby = (notice = '', name = ''): void => {
    mountLobbyView(byId('lobby', HTMLDivElement), lobby, { warnings: loaded.errors.map((e) => `${e.key}: ${e.message} — fallback used`), notice, name })
    lobby.enter()
  }
  lobby.on('join', ({ room, name }) => startGame(loaded, room, name, (notice) => showLobby(notice, name)))
  showLobby()
  Object.assign(window, { __lobby: lobby })
}

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('service worker', e))
}

retryBtn.addEventListener('click', () => void boot())
void boot()
