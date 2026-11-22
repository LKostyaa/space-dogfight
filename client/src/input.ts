import type { Controls } from '@dogfight/shared/sim/ship.ts'

const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

export interface Input {
  /** on-screen buttons press the same virtual keys as the keyboard */
  setKey(code: string, down: boolean): void
  isDown(code: string): boolean
  justPressed(code: string): boolean
  endStep(): void
  destroy(): void
}

export function createInput(target: Window = window): Input {
  const down = new Set<string>()
  const pressed = new Set<string>()

  const onDown = (e: KeyboardEvent): void => {
    if (BLOCK.has(e.code)) e.preventDefault()
    if (e.repeat) return
    down.add(e.code)
    pressed.add(e.code)
  }
  const onUp = (e: KeyboardEvent): void => {
    down.delete(e.code)
  }
  const onBlur = (): void => {
    down.clear()
    pressed.clear()
  }

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)

  return {
    setKey(code, isDown) {
      if (isDown && !down.has(code)) pressed.add(code)
      if (isDown) down.add(code)
      else down.delete(code)
    },
    isDown: (code) => down.has(code),
    justPressed: (code) => pressed.has(code),
    endStep: () => pressed.clear(),
    destroy() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
    },
  }
}

/** Maps raw keys to the abstract controls the simulation understands. */
export function readControls(input: Input): Controls {
  return {
    left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
    right: input.isDown('ArrowRight') || input.isDown('KeyD'),
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    fire: input.isDown('Space'),
  }
}
