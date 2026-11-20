import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateClientMessage } from '../src/protocol.js'

test('accepts a valid join', () => {
  const r = validateClientMessage(JSON.stringify({ v: 0, type: 'join', room: 'alpha', name: 'Kostya' }))
  assert.equal(r.ok, true)
})

test('rejects garbage, unknown types, wrong version and bad fields', () => {
  for (const raw of ['{nope', '[]', 'null', '{"v":0,"type":"hack"}', '{"v":9,"type":"chat","text":"x"}', '{"v":0,"type":"chat","text":""}', '{"v":0,"type":"join","room":"../x","name":"a"}']) {
    assert.equal(validateClientMessage(raw).ok, false, raw)
  }
})
