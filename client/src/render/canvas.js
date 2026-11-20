/**
 * DPR-aware canvas: the backing store is CSS size × devicePixelRatio so lines
 * are crisp on retina screens; the context is scaled so we keep drawing in
 * CSS pixels.
 */
export function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d')
  const view = { width: 0, height: 0, dpr: 1 }

  function resize() {
    view.dpr = window.devicePixelRatio || 1
    view.width = canvas.clientWidth
    view.height = canvas.clientHeight
    canvas.width = Math.round(view.width * view.dpr)
    canvas.height = Math.round(view.height * view.dpr)
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)
  return { ctx, view }
}
