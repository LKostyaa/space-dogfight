import { stepShipState } from '../sim/ship.js'

/**
 * Client-side reconciliation as a pure function.
 *
 * The server says: "after applying your inputs up to `ack`, your ship is at
 * `authoritative`". Inputs after `ack` are still in flight, so we re-apply
 * them on top of the server state with the same stepShipState() the server
 * uses. If prediction was right, the result equals what we already showed.
 *
 * `step` is injectable only for the determinism-break experiment (Lab 5 M2).
 * @returns {{ state, pending }} the re-predicted state and the inputs still unacknowledged
 */
export function reconcile(authoritative, pending, ack, dt, step = stepShipState) {
  const remaining = pending.filter((p) => p.seq > ack)
  let state = authoritative
  for (const p of remaining) state = step(state, p.controls, dt)
  return { state, pending: remaining }
}
