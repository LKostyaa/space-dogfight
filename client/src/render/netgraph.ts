import type { View } from './canvas.ts'
import type { NetGame } from '../net/netgame.ts'
import type { LagSettings } from '../net/latency.ts'

export function drawNetgraph(ctx: CanvasRenderingContext2D, view: View, game: NetGame, lag: LagSettings, codecName: string): void {
  const s = game.stats
  const lines = [
    `codec ${codecName}   RTT ${s.rtt.toFixed(0)} ms`,
    `snapshot age ${s.snapshotAge.toFixed(0)} ms   interp ${game.interpDelay} ms  [ ]`,
    `down ${(s.downBps / 1024).toFixed(1)} KB/s   up ${(s.upBps / 1024).toFixed(2)} KB/s`,
    `pending inputs ${s.pending}   correction ${s.lastCorrection.toFixed(2)} px`,
    `inject lag ${lag.lag}±${lag.jitter} ms drop ${lag.drop}%   (L J D keys)`,
  ]
  const w = 330
  const h = lines.length * 15 + 56
  const x = 8
  const y = view.height - h - 8
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(x, y, w, h)
  ctx.font = '12px ui-monospace, monospace'
  ctx.fillStyle = '#c8f7c5'
  lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 16 + i * 15))
  // correction magnitude per snapshot (sparkline, 0..20 px)
  const gx = x + 8
  const gy = y + h - 8
  ctx.strokeStyle = '#334'
  ctx.strokeRect(gx, gy - 36, w - 16, 36)
  ctx.strokeStyle = '#ffb347'
  ctx.beginPath()
  s.corrections.forEach((c, i) => {
    const px = gx + (i / 90) * (w - 16)
    const py = gy - Math.min(36, (c / 20) * 36)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
}
