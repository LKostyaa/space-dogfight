export interface ArenaPreset {
  readonly name: string
  readonly asteroids: number
  readonly pickups: number
  readonly seed: number
}

/** Arena presets. The server is authoritative, so they live in shared code, not in client assets. */
export const ARENAS = {
  classic: { name: 'Classic', asteroids: 5, pickups: 3, seed: 42 },
  belt: { name: 'Asteroid belt', asteroids: 11, pickups: 4, seed: 7 },
} as const satisfies Record<string, ArenaPreset>

export type ArenaName = keyof typeof ARENAS

export const isArenaName = (s: string): s is ArenaName => Object.hasOwn(ARENAS, s)
