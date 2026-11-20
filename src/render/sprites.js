/**
 * Draws a frame from the sprite sheet with drawImage(source rect -> dest rect).
 * Returns false when the sheet failed to load so the caller can fall back to vector art.
 */
export function createSprites(image, sheet) {
  return {
    ok: Boolean(image),
    draw(ctx, frame, x, y, angle, size) {
      if (!image) return false
      const i = sheet.frames[frame]
      const c = sheet.cell
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(angle)
      ctx.drawImage(image, i * c, 0, c, c, -size / 2, -size / 2, size, size)
      ctx.restore()
      return true
    },
  }
}
