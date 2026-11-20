import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcile } from '../src/net/reconcile.js'
import { stepShipState } from '../src/sim/ship.js'
import { Vector2 } from '../src/sim/vector.js'
import { DT } from '../src/sim/constants.js'

test('reconcile replays unacknowledged inputs and drops acknowledged ones', () => {
  const start = { pos: new Vector2(100, 100), vel: new Vector2(), angle: 0 }
  const inputs = [1, 2, 3, 4, 5].map((seq) => ({ seq, controls: { left: false, right: seq % 2 === 0, thrust: true, fire: false } }))
  // the client predicted all five
  let predicted = start
  for (const i of inputs) predicted = stepShipState(predicted, i.controls, DT)
  // the server processed the first two
  let server = start
  for (const i of inputs.slice(0, 2)) server = stepShipState(server, i.controls, DT)
  const r = reconcile(server, inputs, 2, DT)
  assert.deepEqual(r.pending.map((p) => p.seq), [3, 4, 5])
  assert.ok(Math.abs(r.state.pos.x - predicted.pos.x) < 1e-9)
  assert.ok(Math.abs(r.state.pos.y - predicted.pos.y) < 1e-9)
})
