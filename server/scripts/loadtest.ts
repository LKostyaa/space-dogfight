/**
 * Load test: N headless WebSocket clients fly scripted paths (binary codec, 30 inputs/s,
 * shooting), 8 per room. For each N we record what the server reports in /api/stats:
 * tick-time p99 (worst room), timer jitter p99, event-loop utilization, RSS, bytes/s out.
 *
 *   MAX_ROOMS=40 node server/src/index.ts          # in one terminal
 *   node server/scripts/loadtest.ts 8,32,64,128    # in another
 *   PER_ROOM=64 FIRE_EVERY=2 node server/scripts/loadtest.ts 8,16,32,48,64   # one dense room
 */
import { WebSocket } from 'ws'
import { binaryCodec } from '@dogfight/shared/codec/index.ts'
import { toId, type Seq } from '@dogfight/shared/types.ts'
import { controlsToBits } from '@dogfight/shared/protocol.ts'

const BASE = process.env.TARGET ?? 'http://localhost:3000'
const steps = (process.argv[2] ?? '8,32,64,128').split(',').map(Number)
const MEASURE_S = Number(process.env.MEASURE_S ?? 10)
/** players per room: 8 = normal rooms; 64 = one dense room (needs MAX_PLAYERS_PER_ROOM=64 on the server) */
const PER_ROOM = Number(process.env.PER_ROOM ?? 8)
const FIRE_EVERY = Number(process.env.FIRE_EVERY ?? 6)

interface Stats {
  net: { bytesOut: number }
  rss: number
  elu: number
  rooms: ({ room: string; players: number; tickMs: { p99: number }; jitterMs: { p99: number } } | null)[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stats = async (): Promise<Stats> => (await fetch(`${BASE}/api/stats`)).json() as Promise<Stats>

function client(i: number, run: number): { close(): void; received: () => number } {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws')
  let seq = 0
  let received = 0
  let timer: NodeJS.Timeout | undefined
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: 1, type: 'join', room: `load-${run}-${Math.floor(i / PER_ROOM)}`, name: `load${i}`, codec: 'binary' }))
    timer = setInterval(() => {
      seq++
      const phase = (seq + i * 7) % 90
      const bits = controlsToBits({ left: phase < 20, right: phase > 60, thrust: phase % 3 !== 0, fire: seq % FIRE_EVERY === 0 })
      ws.send(binaryCodec.encodeInput({ seq: toId<Seq>(seq), bits }))
    }, 1000 / 30)
  })
  ws.on('message', (d) => (received += Array.isArray(d) ? 0 : d.byteLength))
  ws.on('error', () => {})
  return {
    close: () => {
      clearInterval(timer)
      ws.close()
    },
    received: () => received,
  }
}

const rows: string[] = []
for (const [run, n] of steps.entries()) {
  const clients = Array.from({ length: n }, (_, i) => client(i, run))
  await sleep(3000) // warm up: joins, JIT
  await stats() // resets the ELU window
  const before = await stats()
  await sleep(MEASURE_S * 1000)
  const after = await stats()
  const rooms = after.rooms.filter((r): r is NonNullable<typeof r> => r !== null && r.room.startsWith(`load-${run}-`))
  const tickP99 = Math.max(...rooms.map((r) => r.tickMs.p99))
  const jitterP99 = Math.max(...rooms.map((r) => r.jitterMs.p99))
  const outKBs = (after.net.bytesOut - before.net.bytesOut) / MEASURE_S / 1024
  const row = { n, rooms: rooms.length, tickP99: +tickP99.toFixed(2), jitterP99: +jitterP99.toFixed(2), elu: +after.elu.toFixed(3), rssMB: Math.round(after.rss / 1048576), outKBs: Math.round(outKBs) }
  console.log(JSON.stringify(row))
  rows.push(`| ${n} | ${row.rooms} | ${row.tickP99} | ${row.jitterP99} | ${(row.elu * 100).toFixed(0)} % | ${row.rssMB} | ${row.outKBs} |`)
  for (const c of clients) c.close()
  await sleep(2000)
}
console.log('\n| N | rooms | tick p99, ms | timer jitter p99, ms | ELU | RSS, MB | out, KB/s |\n|---|---|---|---|---|---|---|')
console.log(rows.join('\n'))
process.exit(0)
