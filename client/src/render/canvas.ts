export interface View {
  width: number
  height: number
  dpr: number
}

/**
 * DPR-aware canvas: the backing store is CSS size × devicePixelRatio so lines
 * are crisp on retina screens; the context is scaled so we keep drawing in
 * CSS pixels.
 */
export function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; view: View } {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not supported')
  const view: View = { width: 0, height: 0, dpr: 1 }

  function resize(): void {
    view.dpr = window.devicePixelRatio || 1
    view.width = canvas.clientWidth
    view.height = canvas.clientHeight
    canvas.width = Math.round(view.width * view.dpr)
    canvas.height = Math.round(view.height * view.dpr)
    ctx?.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)
  return { ctx, view }
}
