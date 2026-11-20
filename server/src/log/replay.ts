import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * Async generator over an NDJSON file: reads it as a stream line by line
 * (never the whole file in memory) and yields parsed events.
 */
export async function* readReplay(file: string): AsyncGenerator<unknown> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    try {
      yield JSON.parse(line)
    } catch {
      // a half-written last line after a crash — skip it
    }
  }
}
