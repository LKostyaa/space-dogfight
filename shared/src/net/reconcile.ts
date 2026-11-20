import { stepShipState, type Controls, type ShipState } from '../sim/ship.ts'
import type { Seq } from '../types.ts'

export interface PendingInput {
  readonly seq: Seq
  readonly controls: Controls
}

export type StepFn = (state: ShipState, controls: Controls, dt: number) => ShipState

/**
 * Client-side reconciliation as a pure function.
 *
 * The server says: "after applying your inputs up to `ack`, your ship is at
 * `authoritative`". Inputs after `ack` are still in flight, so we re-apply
 * them on top of the server state with the same stepShipState() the server
 * uses. If prediction was right, the result equals what we already showed.
 * `step` is injectable only for the determinism-break experiment (Lab 5 M2).
 */
export function reconcile(
  authoritative: ShipState,
  pending: readonly PendingInput[],
  ack: Seq,
  dt: number,
  step: StepFn = stepShipState,
): { state: ShipState; pending: PendingInput[] } {
  const remaining = pending.filter((p) => p.seq > ack)
  let state = authoritative
  for (const p of remaining) state = step(state, p.controls, dt)
  return { state, pending: remaining }
}
