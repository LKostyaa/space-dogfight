import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { on } from 'node:events'
import path from 'node:path'
import type { Room, LogEvent } from '../rooms.ts'

/** Object-mode Transform: one event object in -> one NDJSON line out. */
export function toNdjson(): Transform {
  return new Transform({
    writableObjectMode: true,
    transform(event: LogEvent, _enc, cb) {
      cb(null, JSON.stringify(event) + '\n')
    },
  })
}

export interface MatchLog {
  readonly file: string
  stop(): void
  readonly done: Promise<void>
}

export async function startMatchLog(room: Room, logDir: string): Promise<MatchLog> {
  await mkdir(logDir, { recursive: true })
  const file = path.join(logDir, `${room.id}-${Date.now()}.ndjson`)
  const events = on(room, 'event', { close: ['closed', 'log:end'] })
  const source = Readable.from(
    (async function* () {
      for await (const args of events) {
        const list: unknown = args // events.on yields the listener's arguments as an array
        if (Array.isArray(list)) yield list[0]
      }
    })(),
  )
  const done = pipeline(source, toNdjson(), createWriteStream(file, { flags: 'a' }))
  return { file, stop: () => room.emit('log:end'), done }
}
