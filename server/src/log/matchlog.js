import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { on } from 'node:events'
import path from 'node:path'

/** Object-mode Transform: one event object in -> one NDJSON line out. */
export function toNdjson() {
  return new Transform({
    writableObjectMode: true,
    transform(event, _enc, cb) {
      cb(null, JSON.stringify(event) + '\n')
    },
  })
}

/**
 * Streams every "event" of a room into LOG_DIR/<room>-<timestamp>.ndjson.
 * events.on(...) turns the emitter into an async iterable. It is created
 * eagerly (before anything is emitted) so no event is missed, and it ends on
 * the room's "closed" / "log:end" event — after draining everything queued —
 * which ends the pipeline and flushes the file.
 * Returns { file, stop(), done } where `done` resolves when the file is closed.
 */
export async function startMatchLog(room, logDir) {
  await mkdir(logDir, { recursive: true })
  const file = path.join(logDir, `${room.id}-${Date.now()}.ndjson`)
  const events = on(room, 'event', { close: ['closed', 'log:end'] })
  const source = Readable.from(
    (async function* () {
      for await (const [event] of events) yield event
    })(),
  )
  const done = pipeline(source, toNdjson(), createWriteStream(file, { flags: 'a' }))
  return { file, stop: () => room.emit('log:end'), done }
}
