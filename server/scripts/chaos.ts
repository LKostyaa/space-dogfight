import { WebSocket } from 'ws'
import { binaryCodec } from '@dogfight/shared/codec/index.ts'
import { toId, type Seq } from '@dogfight/shared/types.ts'

const BASE = process.env.TARGET ?? 'http://localhost:3000'
const WS = BASE.replace('http', 'ws') + '/ws'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Stats {
  net: { connections: number; rejected: Record<string, number> }
  rooms: ({ room: string; players: number; tickMs: { p50: number; p99: number } } | null)[]
}
const stats = async (): Promise<Stats> => (await fetch(`${BASE}/api/stats`)).json() as Promise<Stats>
const room = (s: Stats, id: string) => s.rooms.find((r) => r?.room === id) ?? null

function player(roomId: string, name: string): WebSocket {
  const ws = new WebSocket(WS)
  let seq = 0
  ws.on('error', () => {})
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: 1, type: 'join', room: roomId, name }))
    const t = setInterval(() => (ws.readyState === ws.OPEN ? ws.send(binaryCodec.encodeInput({ seq: toId<Seq>(++seq), bits: 4 | (seq % 5 === 0 ? 8 : 0) })) : clearInterval(t)), 33)
  })
  return ws
}

// ---------- 1. client killed mid-match ----------
console.log('\n# 1. client killed mid-match')
const a = player('alpha', 'stays')
const b = player('alpha', 'vanishes')
await sleep(1500)
console.log('players in alpha before:', room(await stats(), 'alpha')?.players)
b.terminate() // destroys the socket: no close frame, like a crashed browser or a pulled cable
await sleep(500)
console.log('players in alpha after :', room(await stats(), 'alpha')?.players, '(server saw the TCP close and removed the ship)')
a.close()

// ---------- 2. garbage flood vs. another room ----------
console.log('\n# 2. garbage flood (~1000 frames/s) vs. room "belt" with 7 bots + 1 player')
await fetch(`${BASE}/api/rooms/belt/bots`, { method: 'DELETE' })
await fetch(`${BASE}/api/rooms/belt/bots`, { method: 'POST', body: JSON.stringify({ count: 7 }) })
const victim = player('belt', 'victim')
await sleep(11_000) // fill the 10 s tick-time window with "calm" samples
const calm = await stats()

let sent = 0
let opened = 0
let stop = false
async function attacker(): Promise<void> {
  while (!stop) {
    const ws = new WebSocket(WS)
    ws.on('error', () => {})
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', () => resolve()) // e.g. 429: per-IP cap
      ws.on('close', () => resolve())
      ws.on('open', () => {
        opened++
        ws.send(JSON.stringify({ v: 1, type: 'join', room: 'flood', name: 'attacker' }))
        const garbage = Buffer.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3])
        const t = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return clearInterval(t)
          for (let i = 0; i < 10; i++, sent++) ws.send(garbage)
        }, 10) // 10 frames per 10 ms = 1000 frames/s
      })
    })
    await sleep(5)
  }
}
const attackers = [attacker(), attacker()]
await sleep(11_000)
const during = await stats()
stop = true
await Promise.all(attackers)

const c = room(calm, 'belt')
const d = room(during, 'belt')
console.log(`garbage frames sent: ${sent}, attacker connections opened: ${opened}`)
console.log('rejections (counted in /metrics):', during.net.rejected)
console.log(`belt tick p50/p99 calm  : ${c?.tickMs.p50.toFixed(3)} / ${c?.tickMs.p99.toFixed(3)} ms`)
console.log(`belt tick p50/p99 attack: ${d?.tickMs.p50.toFixed(3)} / ${d?.tickMs.p99.toFixed(3)} ms`)
victim.close()
await fetch(`${BASE}/api/rooms/belt/bots`, { method: 'DELETE' })
process.exit(0)
