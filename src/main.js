import { createLoop } from './loop.js'
import { createInput, readControls } from './input.js'
import { createShip, integrate } from './sim/ship.js'
import { ARENA, wrap } from './sim/arena.js'
import { setupCanvas } from './render/canvas.js'
import { beginFrame, endFrame, drawShip, drawHud, lerpAngle, lerpPos } from './render/draw.js'

// Lab 1 experiments are switched on with ?exp=block | interval | variable
// and ?autopilot=5 (hold thrust+right for 5 s of game time, then log position).
const params = new URLSearchParams(location.search)
const exp = params.get('exp')
const autopilot = Number(params.get('autopilot') || 0)

const { ctx, view } = setupCanvas(document.getElementById('game'))
const input = createInput(window)

let current = createShip(ARENA.width / 2, ARENA.height / 2)
let previous = current
let simTime = 0
let frameNo = 0

function simulate(dt) {
  previous = current
  const controls = autopilot
    ? { left: false, right: simTime < autopilot, thrust: simTime < autopilot, fire: false }
    : readControls(input)
  current = wrap(integrate(current, controls, dt))
  simTime += dt
  if (autopilot && simTime >= autopilot && !window.__autopilotResult) {
    window.__autopilotResult = { x: current.x, y: current.y, t: simTime }
    console.log('autopilot', JSON.stringify(window.__autopilotResult))
  }
  input.endStep()
}

function render(alpha, stats) {
  if (exp === 'block' && ++frameNo % 60 === 0) {
    const t = performance.now()
    while (performance.now() < t + 100) {
      /* busy-wait: blocks the only thread for 100 ms */
    }
  }
  const s = {
    ...current,
    x: lerpPos(previous.x, current.x, alpha, ARENA.width),
    y: lerpPos(previous.y, current.y, alpha, ARENA.height),
    angle: lerpAngle(previous.angle, current.angle, alpha),
  }
  beginFrame(ctx, view, ARENA)
  drawShip(ctx, s)
  endFrame(ctx)
  drawHud(ctx, [
    `steps/s  ${stats.stepsPerSecond}`,
    `frames/s ${stats.framesPerSecond}`,
    `frame    ${stats.frameTimeMs.toFixed(1)} ms`,
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
