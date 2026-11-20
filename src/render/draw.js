export const lerp = (a, b, t) => a + (b - a) * t

/** Interpolate angles along the shortest arc (π → -π must not spin a full turn). */
export function lerpAngle(a, b, t) {
  let d = b - a
  d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
  return a + d * t
}

/** Interpolate positions, but don't smear across a wrap-around jump. */
export function lerpPos(a, b, t, size) {
  return Math.abs(b - a) > size / 2 ? b : lerp(a, b, t)
}

const stars = Array.from({ length: 220 }, (_, i) => ({
  x: (i * 7919) % 1600,
  y: (i * 104729) % 900,
  r: (i % 3) * 0.5 + 0.5,
}))

/** Fit the fixed-size arena into the window (letterbox). */
export function beginFrame(ctx, view, arena) {
  ctx.fillStyle = '#05070d'
  ctx.fillRect(0, 0, view.width, view.height)
  const scale = Math.min(view.width / arena.width, view.height / arena.height)
  const ox = (view.width - arena.width * scale) / 2
  const oy = (view.height - arena.height * scale) / 2
  ctx.save()
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#0a0e1a'
  ctx.fillRect(0, 0, arena.width, arena.height)
  ctx.fillStyle = '#8fa3c7'
  for (const s of stars) ctx.fillRect(s.x, s.y, s.r, s.r)
}

export function endFrame(ctx) {
  ctx.restore()
}

export function drawShip(ctx, s, color = '#5ec8ff') {
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(s.angle)
  if (s.thrust) {
    ctx.fillStyle = '#ffb347'
    ctx.beginPath()
    ctx.moveTo(-10, -5)
    ctx.lineTo(-20 - Math.random() * 8, 0)
    ctx.lineTo(-10, 5)
    ctx.fill()
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 0)
  ctx.lineTo(-12, -10)
  ctx.lineTo(-7, 0)
  ctx.lineTo(-12, 10)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

export function drawHud(ctx, lines) {
  ctx.font = '13px ui-monospace, monospace'
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(8, 8, 210, 8 + lines.length * 16)
  ctx.fillStyle = '#c8f7c5'
  lines.forEach((l, i) => ctx.fillText(l, 14, 26 + i * 16))
}
