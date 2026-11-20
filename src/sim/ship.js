// Tuning (see README "Налаштування керування"):
// TURN 3.4 rad/s  — a full turn in ~1.85 s, easy to aim, not a spinning top.
// THRUST 480      — noticeable acceleration in half a second.
// DRAG 0.9        — the ship drifts (space!) but stops within ~3 s.
// MAX_SPEED 360   — still readable at 60 Hz.
export const TURN = 3.4
export const THRUST = 480
export const DRAG = 0.9
export const MAX_SPEED = 360

export function createShip(x = 0, y = 0, angle = -Math.PI / 2) {
  return { x, y, vx: 0, vy: 0, angle, thrust: false }
}

export function cloneShip(s) {
  return { ...s }
}

/** Pure: state + controls + dt -> new state. No DOM, no rendering. */
export function integrate(ship, controls, dt) {
  let angle = ship.angle
  if (controls.left) angle -= TURN * dt
  if (controls.right) angle += TURN * dt

  let { vx, vy } = ship
  if (controls.thrust) {
    vx += Math.cos(angle) * THRUST * dt
    vy += Math.sin(angle) * THRUST * dt
  }
  const damp = Math.exp(-DRAG * dt)
  vx *= damp
  vy *= damp

  const speed = Math.hypot(vx, vy)
  if (speed > MAX_SPEED) {
    vx *= MAX_SPEED / speed
    vy *= MAX_SPEED / speed
  }

  return { x: ship.x + vx * dt, y: ship.y + vy * dt, vx, vy, angle, thrust: controls.thrust }
}
