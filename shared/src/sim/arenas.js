/** Arena presets. The server is authoritative, so they live in shared code, not in client assets. */
export const ARENAS = Object.freeze({
  classic: { name: 'Classic', asteroids: 5, pickups: 3, seed: 42 },
  belt: { name: 'Asteroid belt', asteroids: 11, pickups: 4, seed: 7 },
})
