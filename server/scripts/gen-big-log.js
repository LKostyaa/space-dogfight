// Writes a synthetic match log of ~SIZE_MB megabytes (default 200) for the backpressure test.
// Usage: node server/scripts/gen-big-log.js [sizeMB] [logDir]
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { once } from 'node:events'

const sizeMb = Number(process.argv[2] ?? 200)
const dir = process.argv[3] ?? 'logs'
await mkdir(dir, { recursive: true })
const out = createWriteStream(`${dir}/synthetic-big.ndjson`)
let written = 0
let t = Date.now()
while (written < sizeMb * 1024 * 1024) {
  const line = JSON.stringify({ t: t++, room: 'synthetic', type: 'move', playerId: t % 8, x: Math.random() * 1600, y: Math.random() * 900 }) + '\n'
  written += line.length
  if (!out.write(line)) await once(out, 'drain') // respect backpressure while writing, too
}
out.end()
await once(out, 'finish')
console.log(`wrote ${(written / 1024 / 1024).toFixed(0)} MB`)
