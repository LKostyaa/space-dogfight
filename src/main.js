import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { ARENA } from './sim/arena.js'
import { World } from './sim/world.js'
import { Ship } from './sim/ship.js'
import { Vector2 } from './sim/vector.js'
import { setupCanvas } from './render/canvas.js'
import { beginFrame, endFrame, drawEntity, drawHud } from './render/draw.js'

// Lab 1 experiment flags still work: ?exp=block | interval | variable
const params = new URLSearchParams(location.search)
const exp = params.get('exp')

const { ctx, view } = setupCanvas(document.getElementById('game'))
const input = createInput(window)

const world = new World({ seed: 42 })
const me = world.spawn(new Ship({ pos: new Vector2(400, 450), angle: 0, playerId: 1, name: 'you' }))
// a training dummy that flies in circles and never shoots
const dummy = world.spawn(
  new Ship({ pos: new Vector2(1200, 450), angle: Math.PI, playerId: 2, name: 'dummy', color: '#ff8a65' }),
)
world.populate()

const log = []
world.listeners.push((type, detail) => {
  log.unshift(`${type} ${JSON.stringify(detail)}`)
  log.length = Math.min(log.length, 4)
})

function simulate(dt) {
  const inputs = new Map([
    [me.playerId, readControls(input)],
    [dummy.playerId, { left: true, right: false, thrust: true, fire: false }],
  ])
  world.step(dt, inputs)
  input.endStep()
}

function render(alpha, stats) {
  beginFrame(ctx, view, ARENA)
  for (const e of world) drawEntity(ctx, e, alpha)
  endFrame(ctx)
  drawHud(ctx, [
    `steps/s  ${stats.stepsPerSecond}  frames/s ${stats.framesPerSecond}`,
    `frame    ${stats.frameTimeMs.toFixed(1)} ms  entities ${world.size}`,
    `score    ${me.score}   hp ${me.hp}`,
    ...log,
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
