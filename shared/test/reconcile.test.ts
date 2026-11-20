import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile, type PendingInput } from '../src/net/reconcile.ts'
import { stepShipState, type ShipState } from '../src/sim/ship.ts'
import { Vector2 } from '../src/sim/vector.ts'
import { DT } from '../src/sim/constants.ts'
import { toId, type Seq } from '../src/types.ts'

test('reconcile replays unacknowledged inputs and drops acknowledged ones', () => {
  const start: ShipState = { pos: new Vector2(100, 100), vel: new Vector2(), angle: 0 }
  const inputs: PendingInput[] = [1, 2, 3, 4, 5].map((n) => ({ seq: toId<Seq>(n), controls: { left: false, right: n % 2 === 0, thrust: true, fire: false } }))
  let predicted = start
  for (const i of inputs) predicted = stepShipState(predicted, i.controls, DT)
  let server = start
  for (const i of inputs.slice(0, 2)) server = stepShipState(server, i.controls, DT)
  const r = reconcile(server, inputs, toId<Seq>(2), DT)
  assert.deepEqual(r.pending.map((p) => p.seq), [3, 4, 5])
  assert.ok(Math.abs(r.state.pos.x - predicted.pos.x) < 1e-9)
  assert.ok(Math.abs(r.state.pos.y - predicted.pos.y) < 1e-9)
})
