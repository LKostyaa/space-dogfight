export type SpriteFrame = 'ship' | 'shipAlt' | 'asteroid' | 'bullet' | 'shield' | 'rapid' | 'homing'

export interface SheetInfo {
  readonly cell: number
  readonly frames: Readonly<Record<SpriteFrame, number>>
}

export interface Sprites {
  readonly ok: boolean
  draw(ctx: CanvasRenderingContext2D, frame: SpriteFrame, x: number, y: number, angle: number, size: number): boolean
}

export function createSprites(image: HTMLImageElement | null, sheet: SheetInfo): Sprites {
  return {
    ok: image !== null,
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
