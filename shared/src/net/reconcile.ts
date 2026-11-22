import { stepShipState, type Controls, type ShipState } from '../sim/ship.ts'
import type { Seq } from '../types.ts'

export interface PendingInput {
  readonly seq: Seq
  readonly controls: Controls
}

export type StepFn = (state: ShipState, controls: Controls, dt: number) => ShipState

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
