import type { WebSocket } from 'ws'
import { World } from '@dogfight/shared/sim/world.ts'
import { Ship, NO_CONTROLS, type Controls } from '@dogfight/shared/sim/ship.ts'
import { TICK_RATE, DT } from '@dogfight/shared/sim/constants.ts'
import { bitsToControls, type CodecName, type InputMsg } from '@dogfight/shared/protocol.ts'
import { worldToSnapshot, type WorldSnapshot } from '@dogfight/shared/net/snapshot.ts'
import { toId, type PlayerId, type Seq } from '@dogfight/shared/types.ts'
import type { Room } from './rooms.ts'
import type { PlayerInput } from './bot.ts'

const TICK_MS = 1000 / TICK_RATE
const MAX_QUEUE = 8
const MAX_INPUTS_PER_TICK = 3 // catch up after a hiccup, but no speed hacks
const PALETTE = ['#5ec8ff', '#ff8a65', '#b388ff', '#69f0ae', '#ffd54f', '#f06292', '#4dd0e1', '#aed581'] as const

export interface Samples {
  push(v: number): void
  pct(p: number): number
  readonly count: number
}

/** Ring buffer of the last N numbers with percentiles. */
export function createSamples(n = 300): Samples {
  const a: number[] = []
  return {
    push(v) {
      a.push(v)
      if (a.length > n) a.shift()
    },
    pct(p) {
      if (!a.length) return 0
      const s = [...a].sort((x, y) => x - y)
      return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
    },
    get count() {
      return a.length
    },
  }
}

export interface MatchPlayer {
  readonly id: PlayerId
  readonly name: string
  readonly ship: Ship
  readonly socket: WebSocket | null
  readonly codec: CodecName
  readonly queue: { seq: Seq; controls: Controls }[]
  lastSeq: Seq
  controls: Controls
  /** null for humans (inputs arrive over the network), a Bot for AI players */
  readonly ai: PlayerInput | null
}

/** Called once per tick with the world snapshot; the network layer encodes it once per codec. */
export type BroadcastSnapshot = (snapshot: WorldSnapshot, players: Iterable<MatchPlayer>) => void

interface Logger {
  warn(obj: object, msg?: string): void
}

/**
 * The authoritative simulation of one room. 30 Hz: apply queued inputs,
 * step the shared World, send each client a snapshot that says which of its
 * inputs has been applied (`ack`).
 */
export class Match {
  readonly room: Room
  readonly world: World
  readonly players = new Map<PlayerId, MatchPlayer>()
  tick = 0
  running = false
  onBroadcast: BroadcastSnapshot | null = null
  readonly log: Logger | null
  readonly tickMs = createSamples()
  readonly jitterMs = createSamples()
  #timer: NodeJS.Timeout | undefined
  #nextAt = 0

  constructor(room: Room, { seed = 1, asteroids = 6, pickups = 3, log = null }: { seed?: number; asteroids?: number; pickups?: number; log?: Logger | null } = {}) {
    this.room = room
    this.world = new World({ seed })
    this.world.populate({ asteroids, pickups })
    this.log = log
  }

  addPlayer({ id, name, codec = 'binary', socket = null, ai = null }: { id: PlayerId; name: string; codec?: CodecName; socket?: WebSocket | null; ai?: PlayerInput | null }): MatchPlayer {
    const ship = this.world.spawn(
      new Ship({ pos: this.world.findSafeSpot(), angle: 0, playerId: id, name, color: PALETTE[id % PALETTE.length] ?? '#5ec8ff' }),
    )
    ship.driven = true
    const p: MatchPlayer = { id, name, ship, socket, codec, queue: [], lastSeq: toId<Seq>(0), controls: NO_CONTROLS, ai }
    this.players.set(id, p)
    if (!this.running) this.start()
    return p
  }

  removePlayer(id: PlayerId): void {
    const p = this.players.get(id)
    if (!p) return
    this.world.despawn(p.ship.id)
    this.players.delete(id)
    if (this.players.size === 0) this.stop()
  }

  /** Inputs arrive faster or slower than ticks; keep them in order, ignore duplicates/old ones. */
  queueInput(playerId: PlayerId, { seq, bits }: InputMsg): void {
    const p = this.players.get(playerId)
    if (!p) return
    const last = p.queue.at(-1)?.seq ?? p.lastSeq
    if (seq <= last) return
    p.queue.push({ seq, controls: bitsToControls(bits) })
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE) // client is far ahead: drop oldest
  }

  step(): WorldSnapshot {
    // 1. player ships: one physics step per received input (see Ship.update)
    for (const p of this.players.values()) {
      const botInput = p.ai?.nextInput(this.world, p.ship)
      if (botInput) this.queueInput(p.id, botInput) // bots use the same path as humans
      for (let i = 0; i < MAX_INPUTS_PER_TICK; i++) {
        const next = p.queue.shift()
        if (!next) break
        p.controls = next.controls
        p.lastSeq = next.seq
        p.ship.inputSeq = next.seq
        p.ship.remember()
        p.ship.applyInput(next.controls, DT, this.world)
      }
    }
    // 2. everything else + collisions, once per tick
    this.world.step(DT)
    this.tick++
    const events = this.world.drainEvents()
    for (const ev of events) if (ev.type === 'exploded' || ev.type === 'pickup') this.room.record(ev.type, ev)
    return worldToSnapshot(this.world, this.tick, events)
  }

  #loop = (): void => {
    if (!this.running) return
    const start = performance.now()
    this.jitterMs.push(start - this.#nextAt)
    const snap = this.step()
    this.onBroadcast?.(snap, this.players.values())
    this.tickMs.push(performance.now() - start)
    // absolute target times: errors don't accumulate the way chained setTimeout(…, 33) would
    this.#nextAt += TICK_MS
    let delay = this.#nextAt - performance.now()
    if (delay < -TICK_MS * 5) {
      this.log?.warn({ behindMs: Math.round(-delay) }, 'match.fell_behind')
      this.#nextAt = performance.now() + TICK_MS
      delay = TICK_MS
    }
    this.#timer = setTimeout(this.#loop, Math.max(0, Math.ceil(delay)))
  }

  start(): void {
    this.running = true
    this.#nextAt = performance.now() + TICK_MS
    this.#timer = setTimeout(this.#loop, TICK_MS)
  }

  stop(): void {
    this.running = false
    clearTimeout(this.#timer)
  }

  /** Removes all AI players; returns their ids so the caller can free them. */
  removeBots(): PlayerId[] {
    const ids = [...this.players.values()].filter((p) => p.ai).map((p) => p.id)
    for (const id of ids) this.removePlayer(id)
    return ids
  }

  get bots(): number {
    let n = 0
    for (const p of this.players.values()) if (p.ai) n++
    return n
  }

  stats() {
    return {
      room: this.room.id,
      players: this.players.size,
      bots: this.bots,
      tick: this.tick,
      entities: this.world.size,
      tickMs: { p50: this.tickMs.pct(0.5), p99: this.tickMs.pct(0.99) },
      jitterMs: { p50: this.jitterMs.pct(0.5), p99: this.jitterMs.pct(0.99) },
    }
  }
}
