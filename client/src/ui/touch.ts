import type { Input } from '../input.ts'

const BUTTONS = [
  { code: 'ArrowLeft', label: '⟲', side: 'left' },
  { code: 'ArrowRight', label: '⟳', side: 'left' },
  { code: 'Space', label: '●', side: 'right' },
  { code: 'ArrowUp', label: '▲', side: 'right' },
] as const

export function mountTouchControls(input: Input): () => void {
  if (!matchMedia('(pointer: coarse)').matches) return () => {}
  const root = document.createElement('div')
  root.className = 'touch'
  const groups = { left: document.createElement('div'), right: document.createElement('div') }
  root.append(groups.left, groups.right)
  for (const b of BUTTONS) {
    const btn = document.createElement('button')
    btn.textContent = b.label
    btn.className = `touch-btn ${b.side}`
    const press = (down: boolean) => (e: PointerEvent): void => {
      e.preventDefault()
      input.setKey(b.code, down)
    }
    btn.addEventListener('pointerdown', press(true))
    btn.addEventListener('pointerup', press(false))
    btn.addEventListener('pointercancel', press(false))
    btn.addEventListener('pointerleave', press(false))
    groups[b.side].append(btn)
  }
  document.body.append(root)
  return () => root.remove()
}
