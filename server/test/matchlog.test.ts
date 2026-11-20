import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toId, type PlayerId } from '@dogfight/shared/types.ts'
import { Room } from '../src/rooms.ts'
import { startMatchLog } from '../src/log/matchlog.ts'
import { readReplay } from '../src/log/replay.ts'

test('room events go to NDJSON and come back through the replay reader', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ml-'))
  const room = new Room({ id: 'r1', name: 'r1' })
  const log = await startMatchLog(room, dir)
  const id = toId<PlayerId>(1)
  room.join({ id, name: 'a', socket: null })
  room.chat(id, 'hi')
  room.leave(id)
  room.emit('closed')
  await log.done
  const types: string[] = []
  for await (const e of readReplay(log.file)) if (e && typeof e === 'object' && 'type' in e) types.push(String(e.type))
  assert.deepEqual(types, ['join', 'chat', 'leave'])
})
