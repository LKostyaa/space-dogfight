/** Loading screen drawn on the canvas: real progress bar + list of problems. */
export function drawLoading(ctx, view, { done, total, errors = [], fatal = null }) {
  ctx.fillStyle = '#05070d'
  ctx.fillRect(0, 0, view.width, view.height)
  const w = Math.min(420, view.width - 40)
  const x = (view.width - w) / 2
  const y = view.height / 2
  ctx.fillStyle = '#c8d6f0'
  ctx.font = '16px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(fatal ? 'Loading failed' : `Loading… ${done}/${total}`, view.width / 2, y - 24)
  ctx.strokeStyle = '#5ec8ff'
  ctx.strokeRect(x, y, w, 14)
  ctx.fillStyle = fatal ? '#f66' : '#5ec8ff'
  ctx.fillRect(x + 2, y + 2, ((w - 4) * done) / Math.max(1, total), 10)
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillStyle = '#ffb3b3'
  const lines = fatal ? [String(fatal.message ?? fatal)] : errors.map((e) => `${e.key}: ${e.error.message} (fallback used)`)
  lines.forEach((l, i) => ctx.fillText(l, view.width / 2, y + 44 + i * 16))
  ctx.textAlign = 'left'
}
