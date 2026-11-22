import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

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
