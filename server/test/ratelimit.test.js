import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTokenBucket } from '../src/ratelimit.js'

test('token bucket allows a burst, then refills at the given rate', () => {
  let now = 0
  const b = createTokenBucket({ rate: 10, burst: 3, now: () => now })
  assert.deepEqual([b.take(), b.take(), b.take(), b.take()], [true, true, true, false])
  now += 100 // 0.1 s -> 1 token
  assert.equal(b.take(), true)
  assert.equal(b.take(), false)
})
