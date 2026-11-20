import { World } from '@dogfight/shared/sim/world.js'
import { Ship } from '@dogfight/shared/sim/ship.js'
import { TICK_RATE, DT } from '@dogfight/shared/sim/constants.js'
import { bitsToControls } from '@dogfight/shared/protocol/messages.js'
import { worldToSnapshot } from '@dogfight/shared/net/snapshot.js'

const TICK_MS = 1000 / TICK_RATE
const MAX_QUEUE = 8
const MAX_INPUTS_PER_TICK = 3 // catch up after a hiccup, but no speed hacks
const PALETTE = ['#5ec8ff', '#ff8a65', '#b388ff', '#69f0ae', '#ffd54f', '#f06292', '#4dd0e1', '#aed581']
const NO_CONTROLS = { left: false, right: false, thrust: false, fire: false }

/** Ring buffer of the last N numbers with percentiles. */
export function createSamples(n = 300) {
  const a = []
  return {
    push(v) {
      a.push(v)
      if (a.length > n) a.shift()
    },
    pct(p) {
      if (!a.length) return 0
      const s = [...a].sort((x, y) => x - y)
      return s[Math.min(s.length - 1, Math.floor(p * s.length))]
    },
    get count() {
      return a.length
    },
  }
}

/**
 * The authoritative simulation of one room. 30 Hz: apply at most one queued
 * input per player, step the shared World, broadcast a snapshot that tells
 * each client which of its inputs has been applied (`ack`).
 */
export class Match {
  constructor(room, { seed = 1, asteroids = 6, pickups = 3, onSend, log } = {}) {
    this.room = room
    this.world = new World({ seed })
    this.world.populate({ asteroids, pickups })
    this.players = new Map()
    this.tick = 0
    this.running = false
    this.onSend = onSend // (player, snapshot) => void
    this.log = log
    this.tickMs = createSamples()
    this.jitterMs = createSamples()
    this.timer = 0
  }

  addPlayer({ id, name, codec = 'binary', socket, isBot = false }) {
    const ship = this.world.spawn(
      new Ship({ pos: this.world.findSafeSpot(), angle: 0, playerId: id, name, color: PALETTE[id % PALETTE.length] }),
    )
    ship.driven = true
    const p = { id, name, ship, socket, codec, queue: [], lastSeq: 0, controls: NO_CONTROLS, isBot }
    this.players.set(id, p)
    if (!this.running) this.start()
    return p
  }

  removePlayer(id) {
    const p = this.players.get(id)
    if (!p) return
    this.world.despawn(p.ship.id)
    this.players.delete(id)
    if (this.players.size === 0) this.stop()
  }

  /** Inputs arrive faster or slower than ticks; keep them in order, ignore duplicates/old ones. */
  queueInput(playerId, { seq, bits }) {
    const p = this.players.get(playerId)
    if (!p) return
    const last = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq
    if (seq <= last) return
    p.queue.push({ seq, controls: bitsToControls(bits) })
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE) // client is far ahead: drop oldest
  }

  step() {
    // 1. player ships: one physics step per received input (see Ship.update)
    for (const p of this.players.values()) {
      for (let i = 0; i < MAX_INPUTS_PER_TICK && p.queue.length; i++) {
        const next = p.queue.shift()
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

  #loop = () => {
    if (!this.running) return
    const start = performance.now()
    this.jitterMs.push(start - this.nextAt)
    const snap = this.step()
    for (const p of this.players.values()) this.onSend?.(p, { ...snap, ack: p.lastSeq })
    this.tickMs.push(performance.now() - start)
    // absolute target times: errors don't accumulate the way chained setTimeout(…, 33) would
    this.nextAt += TICK_MS
    let delay = this.nextAt - performance.now()
    if (delay < -TICK_MS * 5) {
      this.log?.warn?.(`room ${this.room.id}: fell ${(-delay).toFixed(0)} ms behind, resetting clock`)
      this.nextAt = performance.now() + TICK_MS
      delay = TICK_MS
    }
    this.timer = setTimeout(this.#loop, Math.max(0, Math.ceil(delay)))
  }

  start() {
    this.running = true
    this.nextAt = performance.now() + TICK_MS
    this.timer = setTimeout(this.#loop, TICK_MS)
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
  }

  stats() {
    return {
      room: this.room.id,
      players: this.players.size,
      tick: this.tick,
      entities: this.world.size,
      tickMs: { p50: this.tickMs.pct(0.5), p99: this.tickMs.pct(0.99) },
      jitterMs: { p50: this.jitterMs.pct(0.5), p99: this.jitterMs.pct(0.99) },
    }
  }
}
