import { getCodec, CodecError, type Codec, type Wire } from '@dogfight/shared/codec/index.ts'
import { controlsToBits, ShipFlag, type CodecName, type EntitySnap, type EventSnap, type ShipSnap } from '@dogfight/shared/protocol.ts'
import { stepShipState, FIRE_COOLDOWN, BULLET_SPEED, type Controls, type ShipState } from '@dogfight/shared/sim/ship.ts'
import { BULLET_TTL } from '@dogfight/shared/sim/bullet.ts'
import { reconcile, type PendingInput, type StepFn } from '@dogfight/shared/net/reconcile.ts'
import { DT, TICK_RATE } from '@dogfight/shared/sim/constants.ts'
import { ARENA, wrapPos } from '@dogfight/shared/sim/arena.ts'
import { Vector2 } from '@dogfight/shared/sim/vector.ts'
import { createRng } from '@dogfight/shared/sim/rng.ts'
import { Bus } from '@dogfight/shared/sim/world.ts'
import { toId, assertNever, type EntityId, type PlayerId, type Seq, type Tick } from '@dogfight/shared/types.ts'
import type { Connection } from './connection.ts'
import type { Lagger } from './latency.ts'
import { point, type ViewEntity, type ViewExplosion, type ViewShip, type ViewBullet } from '../render/view-entity.ts'
import { measure } from '../perf.ts'

const TICK_MS = 1000 / TICK_RATE
const SMOOTH_MS = 100
// Lab 7: was 40 (1.3 s). Decoded snapshots lived long enough to be promoted to the old generation
// and caused major GCs; interpolation needs ~4. 12 = 400 ms covers interpDelay up to ~300 ms.
const BUFFER = 12

/** Events the client's audio/HUD listen to: exactly the snapshot events. */
export type ClientEvents = { [K in EventSnap['type']]: EventSnap }

/** Shortest wrap-aware difference a - b along one axis. */
const wrapDelta = (a: number, b: number, size: number): number => {
  let d = a - b
  if (d > size / 2) d -= size
  if (d < -size / 2) d += size
  return d
}
const lerpWrap = (a: number, b: number, t: number, size: number): number => {
  const v = a + wrapDelta(b, a, size) * t
  return ((v % size) + size) % size
}
const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

/**
 * Lab 5 M2 experiment (?breakdet=1): what happens if integrate() is not deterministic,
 * e.g. someone adds Math.random() to it. Client and server physics no longer agree.
 */
const nondeterministicStep: StepFn = (state, controls, dt) => {
  const n = stepShipState(state, controls, dt)
  return { ...n, pos: n.pos.add(n.vel.scale(dt * (Math.random() - 0.5) * 0.3)) }
}

interface PredictedBullet {
  readonly seq: number
  pos: Vector2
  prevPos: Vector2
  readonly vel: Vector2
  ttl: number
  readonly born: number
  confirmed: boolean
  readonly homing: boolean
  readonly view: ViewBullet
}

const PARTICLES = 18

interface BufferedSnapshot {
  readonly time: number
  readonly arrived: number
  readonly tick: Tick
  readonly entities: ReadonlyMap<EntityId, EntitySnap>
}

export interface NetStats {
  rtt: number
  snapshotAge: number
  downBps: number
  upBps: number
  corrections: number[]
  lastCorrection: number
  pending: number
}

export interface NetGameOptions {
  conn: Connection
  codec?: CodecName
  lagger: Lagger
  bus: Bus<ClientEvents>
  interpDelay?: number
  predict?: boolean
  breakDeterminism?: boolean
}

/**
 * Client side of the netcode:
 *  - my ship: predicted locally with the shared stepShipState, reconciled on every snapshot
 *  - everything else: rendered `interpDelay` ms in the past, interpolated between snapshots
 *  - my bullets: predicted (spawned at once), hidden when the server's copy takes over
 */
export class NetGame {
  readonly conn: Connection
  readonly codec: Codec
  readonly lagger: Lagger
  readonly bus: Bus<ClientEvents>
  interpDelay: number
  readonly predict: boolean
  readonly stepFn: StepFn
  myId: PlayerId = toId<PlayerId>(0)
  seq = 0
  pending: PendingInput[] = []
  predicted: ShipState | null = null
  prevPredicted: ShipState | null = null
  smooth = { x: 0, y: 0 }
  myFlags = 0
  myShip: ShipSnap | null = null
  cooldown = 0
  bullets: PredictedBullet[] = []
  effects: ViewExplosion[] = []
  /** Lab 7: view objects are reused frame to frame instead of allocated (see README, profiling). */
  readonly #views = new Map<EntityId, ViewEntity>()
  readonly #touched = new Set<EntityId>()
  readonly #out: ViewEntity[] = []
  readonly #explosionPool: ViewExplosion[] = []
  readonly #myView: ViewShip = {
    kind: 'ship', pos: point(), prevPos: point(), angle: 0, prevAngle: 0, homing: false,
    radius: 14, name: '', color: '#5ec8ff', hp: 0, dead: false, shield: false, thrust: false,
  }
  buffer: BufferedSnapshot[] = []
  lastTick = -1
  clockOffset: number | null = null
  readonly rng = createRng(1)
  readonly players = new Map<number, { name: string; color: string | undefined }>()
  readonly stats: NetStats = { rtt: 0, snapshotAge: 0, downBps: 0, upBps: 0, corrections: [], lastCorrection: 0, pending: 0 }
  #bytes = { in: 0, out: 0, at: performance.now() }
  readonly #pingTimer: number

  constructor({ conn, codec = 'binary', lagger, bus, interpDelay = 100, predict = true, breakDeterminism = false }: NetGameOptions) {
    this.conn = conn
    this.codec = getCodec(codec)
    this.lagger = lagger
    this.bus = bus
    this.interpDelay = interpDelay
    this.predict = predict // ?predict=0 — Lab 5 M1: dumb client, my ship moves only on snapshots
    this.stepFn = breakDeterminism ? nondeterministicStep : stepShipState // ?breakdet=1 — Lab 5 M2

    conn.on('welcome', (m) => (this.myId = m.playerId))
    conn.on('roster', (m) => {
      for (const p of m.players) this.players.set(p.id, { name: p.name, color: p.color })
    })
    conn.on('binary', (data) => this.#receive(data))
    conn.on('snapshot', (data) => this.#receive(data))
    conn.on('pong', (m) => lagger.delay(() => (this.stats.rtt = performance.now() - m.t)))
    this.#pingTimer = window.setInterval(() => this.#send(JSON.stringify({ v: 1, type: 'ping', t: performance.now() })), 1000)
  }

  #send(data: Wire): void {
    this.#bytes.out += typeof data === 'string' ? data.length : data.byteLength
    this.lagger.delay(() => this.conn.send(data))
  }

  #receive(raw: Wire): void {
    const size = typeof raw === 'string' ? raw.length : raw.byteLength
    this.lagger.delay(() => {
      this.#bytes.in += size
      try {
        const snap = measure('decode', () => this.codec.decodeSnapshot(raw))
        this.#onSnapshot(snap)
      } catch (e: unknown) {
        if (e instanceof CodecError) console.warn('bad snapshot', e.message)
        else throw e
      }
    })
  }

  #onSnapshot(snap: ReturnType<Codec['decodeSnapshot']>): void {
    if (snap.tick <= this.lastTick) return // late (reordered) snapshot: a newer one already arrived
    this.lastTick = snap.tick
    const now = performance.now()

    // clock: arrival time minus server time. The smallest sample is the least delayed one.
    const sample = now - snap.tick * TICK_MS
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample
    else this.clockOffset += (sample - this.clockOffset) * 0.002 // follow slow drift upwards

    const entities = new Map(snap.entities.map((e) => [e.id, e] as const))
    this.buffer.push({ time: snap.tick * TICK_MS, arrived: now, tick: snap.tick, entities })
    if (this.buffer.length > BUFFER) this.buffer.shift()

    // --- my ship: reconcile ---
    const mine = snap.entities.find((e): e is ShipSnap => e.kind === 'ship' && e.playerId === this.myId) ?? null
    this.myShip = mine
    this.myFlags = mine?.flags ?? 0
    if (!mine || mine.flags & ShipFlag.DEAD) {
      this.predicted = null
      this.pending = this.pending.filter((p) => p.seq > snap.ack)
    } else {
      const server: ShipState = { pos: new Vector2(mine.x, mine.y), vel: new Vector2(mine.vx, mine.vy), angle: mine.angle }
      const r = measure('reconcile', () => reconcile(server, this.pending, snap.ack, DT, this.stepFn))
      if (this.predicted && this.prevPredicted) {
        const dx = wrapDelta(this.predicted.pos.x, r.state.pos.x, ARENA.width)
        const dy = wrapDelta(this.predicted.pos.y, r.state.pos.y, ARENA.height)
        const err = Math.hypot(dx, dy)
        this.stats.lastCorrection = err
        this.stats.corrections.push(err)
        if (this.stats.corrections.length > 90) this.stats.corrections.shift()
        // big jumps (respawn, teleport) are not smoothed
        if (err < 80) {
          this.smooth.x += dx
          this.smooth.y += dy
        } else this.smooth = { x: 0, y: 0 }
        // keep the render interpolation continuous
        this.prevPredicted = { ...this.prevPredicted, pos: this.prevPredicted.pos.sub(new Vector2(dx, dy)) }
      } else {
        this.prevPredicted = r.state
      }
      this.predicted = r.state
      this.pending = r.pending
    }

    // --- my predicted bullets vs the server's ---
    const serverMine = new Set(snap.entities.flatMap((e) => (e.kind === 'bullet' && e.owner === this.myId ? [e.seq] : [])))
    this.bullets = this.bullets.filter((b) => {
      if (serverMine.has(b.seq & 0xffff)) b.confirmed = true
      else if (b.confirmed) return false // server bullet is gone (hit something)
      else if (now - b.born > 400 + this.stats.rtt) return false // server never fired it
      return true
    })

    // --- events -> effects + bus (audio, HUD) ---
    for (const ev of snap.events) {
      if (ev.type === 'exploded') this.#explosion(ev.x, ev.y, ev.kind === 'ship' ? '#ffb347' : '#b8a58a')
      if (ev.type === 'fired' && ev.playerId === this.myId) continue // already played locally
      this.bus.emit(ev.type, ev)
    }
  }

  /** Explosions come from a pool; particles are plain numbers updated in place. */
  #explosion(x: number, y: number, color: string): void {
    const pos = point(x, y)
    const fx: ViewExplosion = this.#explosionPool.pop() ?? {
      kind: 'explosion',
      pos,
      prevPos: pos,
      angle: 0,
      prevAngle: 0,
      homing: false,
      color,
      life: 0,
      particles: Array.from({ length: PARTICLES }, () => ({ x: 0, y: 0, vx: 0, vy: 0 })),
    }
    fx.pos.x = x
    fx.pos.y = y
    fx.color = color
    fx.life = 0.7
    for (const p of fx.particles) {
      const a = this.rng.range(0, Math.PI * 2)
      const v = this.rng.range(40, 220)
      p.x = 0
      p.y = 0
      p.vx = Math.cos(a) * v
      p.vy = Math.sin(a) * v
    }
    this.effects.push(fx)
  }

  /** One client simulation step (30 Hz): send the input, predict my ship and bullets. */
  step(controls: Controls): void {
    if (!this.myId) return
    this.seq++
    const seq = toId<Seq>(this.seq)
    this.#send(this.codec.encodeInput({ seq, bits: controlsToBits(controls) }))
    if (this.predicted && this.predict) {
      this.prevPredicted = this.predicted
      this.predicted = this.stepFn(this.predicted, controls, DT)
      this.pending.push({ seq, controls })
      // bullet prediction: same cooldown rule as the server
      this.cooldown = Math.max(0, this.cooldown - DT)
      if (controls.fire && this.cooldown === 0) {
        const s = this.predicted
        const nose = s.pos.add(Vector2.fromAngle(s.angle, 18))
        const bv = point()
        this.bullets.push({
          view: { kind: 'bullet', pos: bv, prevPos: bv, angle: s.angle, prevAngle: s.angle, homing: (this.myFlags & ShipFlag.HOMING) !== 0, radius: 3 },
          seq: this.seq,
          pos: nose,
          prevPos: nose,
          vel: s.vel.add(Vector2.fromAngle(s.angle, BULLET_SPEED)),
          ttl: BULLET_TTL,
          born: performance.now(),
          confirmed: false,
          homing: (this.myFlags & ShipFlag.HOMING) !== 0,
        })
        this.cooldown = this.myFlags & ShipFlag.RAPID ? FIRE_COOLDOWN / 2.5 : FIRE_COOLDOWN
        this.bus.emit('fired', { type: 'fired', kind: '', effect: '', x: s.pos.x, y: s.pos.y, playerId: this.myId, by: 0 })
      }
    }
    for (const b of this.bullets) {
      b.prevPos = b.pos
      b.pos = wrapPos(b.pos.add(b.vel.scale(DT)))
      b.ttl -= DT
    }
    this.bullets = this.bullets.filter((b) => b.ttl > 0)
    this.stats.pending = this.pending.length
  }

  /**
   * Called every render frame. Returns drawable view objects.
   * Allocation-free in steady state: view objects live in #views (one per entity id),
   * the output array is reused, positions are written into existing points.
   */
  view(alpha: number, dtFrame: number): readonly ViewEntity[] {
    const now = performance.now()
    // decay the correction offset smoothly over ~SMOOTH_MS
    const k = Math.exp(-(dtFrame * 1000) / (SMOOTH_MS / 3))
    this.smooth.x *= k
    this.smooth.y *= k

    const out = this.#out
    out.length = 0
    this.#touched.clear()
    const renderTime = now - (this.clockOffset ?? 0) - this.interpDelay
    let a: BufferedSnapshot | undefined
    let b: BufferedSnapshot | undefined
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const s = this.buffer[i]
      if (s && s.time <= renderTime) {
        a = s
        b = this.buffer[i + 1]
        break
      }
    }
    a ??= this.buffer[0] // not enough history yet
    const t = a && b ? Math.min(1, (renderTime - a.time) / (b.time - a.time)) : 0

    if (a) {
      for (const ea of a.entities.values()) {
        if (ea.kind === 'ship' && ea.playerId === this.myId && this.predict) continue
        if (ea.kind === 'bullet' && ea.owner === this.myId && this.#hasPredicted(ea.seq)) continue
        const eb = b?.entities.get(ea.id)
        if (b && !eb) continue // gone in the next snapshot: it died
        const v = this.#viewFor(ea, eb && eb.kind === ea.kind ? eb : ea, t)
        this.#touched.add(ea.id)
        out.push(v)
      }
    }
    // forget views of entities that are gone
    for (const id of this.#views.keys()) if (!this.#touched.has(id)) this.#views.delete(id)

    if (this.predicted && this.prevPredicted && this.myShip && this.predict) {
      const p0 = this.prevPredicted
      const p1 = this.predicted
      const v = this.#myView
      v.pos.x = lerpWrap(p0.pos.x, p1.pos.x, alpha, ARENA.width) + this.smooth.x
      v.pos.y = lerpWrap(p0.pos.y, p1.pos.y, alpha, ARENA.height) + this.smooth.y
      v.prevPos = v.pos
      v.angle = v.prevAngle = lerpAngle(p0.angle, p1.angle, alpha)
      this.#fillShip(v, this.myShip)
      out.push(v)
    }
    for (const bl of this.bullets) {
      bl.view.pos.x = lerpWrap(bl.prevPos.x, bl.pos.x, alpha, ARENA.width)
      bl.view.pos.y = lerpWrap(bl.prevPos.y, bl.pos.y, alpha, ARENA.height)
      out.push(bl.view)
    }

    let alive = 0
    for (const fx of this.effects) {
      fx.life -= dtFrame
      for (const p of fx.particles) {
        p.x += p.vx * dtFrame
        p.y += p.vy * dtFrame
      }
      if (fx.life > 0) {
        this.effects[alive++] = fx
        out.push(fx)
      } else this.#explosionPool.push(fx)
    }
    this.effects.length = alive

    const latest = this.buffer.at(-1)
    this.stats.snapshotAge = latest ? now - latest.arrived : 0
    if (now - this.#bytes.at >= 1000) {
      const secs = (now - this.#bytes.at) / 1000
      this.stats.downBps = this.#bytes.in / secs
      this.stats.upBps = this.#bytes.out / secs
      this.#bytes = { in: 0, out: 0, at: now }
    }
    return out
  }

  #hasPredicted(seq: number): boolean {
    for (const p of this.bullets) if ((p.seq & 0xffff) === seq) return true
    return false
  }

  #fillShip(v: ViewShip, e: ShipSnap): void {
    const mine = e.playerId === this.myId
    v.name = this.players.get(e.playerId)?.name ?? 'pilot'
    v.color = mine ? '#5ec8ff' : '#ff8a65'
    v.hp = e.hp
    v.dead = (e.flags & ShipFlag.DEAD) !== 0
    v.shield = (e.flags & ShipFlag.SHIELD) !== 0
    v.thrust = (e.flags & ShipFlag.THRUST) !== 0
  }

  /** Interpolated view of one snapshot entity, reusing the object from the previous frame. */
  #viewFor(ea: EntitySnap, s: EntitySnap, t: number): ViewEntity {
    let v = this.#views.get(ea.id)
    if (!v || v.kind !== s.kind) {
      v = this.#createView(s)
      this.#views.set(ea.id, v)
    }
    const moved = s !== ea
    v.pos.x = moved ? lerpWrap(ea.x, s.x, t, ARENA.width) : ea.x
    v.pos.y = moved ? lerpWrap(ea.y, s.y, t, ARENA.height) : ea.y
    switch (s.kind) {
      case 'ship':
        if (v.kind === 'ship') {
          v.angle = v.prevAngle = ea.kind === 'ship' ? lerpAngle(ea.angle, s.angle, t) : s.angle
          this.#fillShip(v, s)
        }
        break
      case 'asteroid':
        v.angle = v.prevAngle = ea.kind === 'asteroid' ? lerpAngle(ea.angle, s.angle, t) : s.angle
        v.homing = s.homing
        break
      case 'bullet':
        v.angle = v.prevAngle = Math.atan2(s.vy, s.vx)
        v.homing = s.homing
        break
      case 'pickup':
        v.angle = v.prevAngle = performance.now() / 1000
        break
      default:
        assertNever(s, 'snapshot entity')
    }
    return v
  }

  #createView(s: EntitySnap): ViewEntity {
    const pos = point(s.x, s.y)
    const base = { pos, prevPos: pos, angle: 0, prevAngle: 0, homing: false }
    switch (s.kind) {
      case 'ship':
        return { ...base, kind: 'ship', radius: 14, name: '', color: '', hp: 0, dead: false, shield: false, thrust: false }
      case 'bullet':
        return { ...base, kind: 'bullet', radius: 3 }
      case 'asteroid':
        return { ...base, kind: 'asteroid', radius: s.radius }
      case 'pickup':
        return { ...base, kind: 'pickup', effect: s.effect }
      default:
        return assertNever(s, 'snapshot entity')
    }
  }

  get myScore(): number {
    return this.myShip?.score ?? 0
  }

  destroy(): void {
    window.clearInterval(this.#pingTimer)
  }
}
