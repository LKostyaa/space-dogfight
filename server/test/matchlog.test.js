import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Room } from '../src/rooms.js'
import { startMatchLog } from '../src/log/matchlog.js'
import { readReplay } from '../src/log/replay.js'

test('room events go to NDJSON and come back through the replay reader', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ml-'))
  const room = new Room({ id: 'r1', name: 'r1' })
  const log = await startMatchLog(room, dir)
  room.join({ id: 1, name: 'a' })
  room.chat(1, 'hi')
  room.leave(1)
  await new Promise((r) => setImmediate(r))
  room.emit('closed')
  await log.done
  const events = []
  for await (const e of readReplay(log.file)) events.push(e.type)
  assert.deepEqual(events, ['join', 'chat', 'leave'])
})
