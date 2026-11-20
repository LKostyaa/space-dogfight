import { ARENA } from '../sim/arena.js'

export const lerp = (a, b, t) => a + (b - a) * t

/** Interpolate angles along the shortest arc (π → -π must not spin a full turn). */
export function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * t
}

/** Interpolate positions, but don't smear across a wrap-around jump. */
export function lerpPos(a, b, t, size) {
  return Math.abs(b - a) > size / 2 ? b : lerp(a, b, t)
}

/** Interpolated pose of an entity for this render frame. */
export function pose(e, alpha) {
  return {
    x: lerpPos(e.prevPos.x, e.pos.x, alpha, ARENA.width),
    y: lerpPos(e.prevPos.y, e.pos.y, alpha, ARENA.height),
    angle: lerpAngle(e.prevAngle, e.angle, alpha),
  }
}

const stars = Array.from({ length: 220 }, (_, i) => ({
  x: (i * 7919) % 1600,
  y: (i * 104729) % 900,
  r: (i % 3) * 0.5 + 0.5,
}))

/** Fit the fixed-size arena into the window (letterbox). */
export function beginFrame(ctx, view, arena = ARENA) {
  ctx.fillStyle = '#05070d'
  ctx.fillRect(0, 0, view.width, view.height)
  const scale = Math.min(view.width / arena.width, view.height / arena.height)
  ctx.save()
  ctx.translate((view.width - arena.width * scale) / 2, (view.height - arena.height * scale) / 2)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#0a0e1a'
  ctx.fillRect(0, 0, arena.width, arena.height)
  ctx.fillStyle = '#8fa3c7'
  for (const s of stars) ctx.fillRect(s.x, s.y, s.r, s.r)
}

export function endFrame(ctx) {
  ctx.restore()
}

export function drawShip(ctx, ship, p, sprites) {
  if (ship.dead) return
  if (sprites?.ok) {
    if (ship.controls?.thrust || ship.thrust) drawFlame(ctx, p)
    sprites.draw(ctx, ship.color === '#5ec8ff' ? 'ship' : 'shipAlt', p.x, p.y, p.angle, 44)
    drawShipDecor(ctx, ship, p)
    return
  }
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  if (ship.controls?.thrust || ship.thrust) {
    ctx.fillStyle = '#ffb347'
    ctx.beginPath()
    ctx.moveTo(-10, -5)
    ctx.lineTo(-20 - (performance.now() % 80) / 10, 0)
    ctx.lineTo(-10, 5)
    ctx.fill()
  }
  ctx.strokeStyle = ship.color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 0)
  ctx.lineTo(-12, -10)
  ctx.lineTo(-7, 0)
  ctx.lineTo(-12, 10)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
  drawShipDecor(ctx, ship, p)
}

function drawFlame(ctx, p) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  ctx.fillStyle = '#ffb347'
  ctx.beginPath()
  ctx.moveTo(-10, -5)
  ctx.lineTo(-20 - (performance.now() % 80) / 10, 0)
  ctx.lineTo(-10, 5)
  ctx.fill()
  ctx.restore()
}

function drawShipDecor(ctx, ship, p) {
  if (ship.shield > 0) {
    ctx.strokeStyle = 'rgba(120,220,255,0.6)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2)
    ctx.stroke()
  }
  // name + hp bar
  ctx.fillStyle = '#dde'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(ship.name, p.x, p.y - 26)
  ctx.fillStyle = '#333'
  ctx.fillRect(p.x - 16, p.y + 22, 32, 3)
  ctx.fillStyle = ship.hp > 40 ? '#6f6' : '#f66'
  ctx.fillRect(p.x - 16, p.y + 22, (32 * ship.hp) / 100, 3)
  ctx.textAlign = 'left'
}

export function drawEntity(ctx, e, alpha, sprites) {
  const p = pose(e, alpha)
  switch (e.kind) {
    case 'ship':
      return drawShip(ctx, e, p, sprites)
    case 'bullet':
      if (!e.behaviors.length && sprites?.draw(ctx, 'bullet', p.x, p.y, p.angle, 20)) return
      ctx.fillStyle = e.behaviors.length ? '#ff6bd6' : '#fff6a0'
      ctx.beginPath()
      ctx.arc(p.x, p.y, e.radius, 0, Math.PI * 2)
      ctx.fill()
      return
    case 'asteroid': {
      if (!e.behaviors.length && sprites?.draw(ctx, 'asteroid', p.x, p.y, p.angle, e.radius * 2.2)) return
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)
      ctx.strokeStyle = e.behaviors.length ? '#ff8a65' : '#b8a58a'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        const r = e.radius * (0.82 + ((i * 37) % 7) / 30)
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
      return
    }
    case 'pickup': {
      if (sprites?.draw(ctx, e.effect, p.x, p.y, 0, 40)) return
      const colors = { shield: '#78dcff', rapid: '#ffd54f', homing: '#ff6bd6' }
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)
      ctx.strokeStyle = colors[e.effect]
      ctx.lineWidth = 2
      ctx.strokeRect(-9, -9, 18, 18)
      ctx.restore()
      ctx.fillStyle = colors[e.effect]
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(e.effect, p.x, p.y + 24)
      ctx.textAlign = 'left'
      return
    }
    case 'explosion':
      ctx.fillStyle = e.color
      ctx.globalAlpha = Math.max(0, e.life / 0.7)
      for (const q of e.particles) ctx.fillRect(e.pos.x + q.offset.x, e.pos.y + q.offset.y, 2, 2)
      ctx.globalAlpha = 1
      return
  }
}

export function drawHud(ctx, lines) {
  ctx.font = '13px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(8, 8, 230, 8 + lines.length * 16)
  ctx.fillStyle = '#c8f7c5'
  lines.forEach((l, i) => ctx.fillText(l, 14, 26 + i * 16))
}
