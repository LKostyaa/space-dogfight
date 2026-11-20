import { getCodec } from '@dogfight/shared/codec/index.js'
import { controlsToBits, ShipFlag } from '@dogfight/shared/protocol/messages.js'
import { stepShipState, FIRE_COOLDOWN, BULLET_SPEED } from '@dogfight/shared/sim/ship.js'
import { BULLET_TTL } from '@dogfight/shared/sim/bullet.js'
import { reconcile } from '@dogfight/shared/net/reconcile.js'
import { DT, TICK_RATE } from '@dogfight/shared/sim/constants.js'
import { ARENA, wrapPos } from '@dogfight/shared/sim/arena.js'
import { Vector2 } from '@dogfight/shared/sim/vector.js'
import { createRng } from '@dogfight/shared/sim/rng.js'

const TICK_MS = 1000 / TICK_RATE
const SMOOTH_MS = 100
const BUFFER = 40

/** Shortest wrap-aware difference a - b along one axis. */
const wrapDelta = (a, b, size) => {
  let d = a - b
  if (d > size / 2) d -= size
  if (d < -size / 2) d += size
  return d
}
const lerpWrap = (a, b, t, size) => {
  const v = a + wrapDelta(b, a, size) * t
  return ((v % size) + size) % size
}
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t

/**
 * Client side of the netcode:
 *  - my ship: predicted locally with the shared stepShipState, reconciled on every snapshot
 *  - everything else: rendered `interpDelay` ms in the past, interpolated between snapshots
 *  - my bullets: predicted (spawned at once), hidden when the server's copy takes over
 */
export class NetGame {
  constructor({ conn, codec = 'binary', lagger, bus, interpDelay = 100, predict = true, breakDeterminism = false }) {
    this.conn = conn
    this.codec = getCodec(codec)
    this.lagger = lagger
    this.bus = bus
    this.interpDelay = interpDelay
    this.predict = predict // ?predict=0 — Lab 5 M1: dumb client, my ship moves only on snapshots
    this.stepFn = breakDeterminism ? nondeterministicStep : stepShipState // ?breakdet=1 — Lab 5 M2 experiment
    this.myId = 0
    this.seq = 0
    this.pending = []
    this.predicted = null
    this.prevPredicted = null
    this.smooth = { x: 0, y: 0 }
    this.myFlags = 0
    this.myShip = null // last authoritative entity for my ship (hp, score…)
    this.cooldown = 0
    this.bullets = [] // predicted bullets
    this.effects = []
    this.buffer = []
    this.lastTick = -1
    this.clockOffset = null
    this.rng = createRng(1)
    this.players = new Map() // playerId -> { name, color }
    this.stats = { rtt: 0, snapshotAge: 0, downBps: 0, upBps: 0, corrections: [], lastCorrection: 0, pending: 0 }
    this._bytes = { in: 0, out: 0, at: performance.now() }

    conn.addEventListener('welcome', (e) => (this.myId = e.detail.playerId))
    conn.addEventListener('roster', (e) => {
      for (const p of e.detail.players) this.players.set(p.id, { name: p.name, color: p.color })
    })
    conn.addEventListener('binary', (e) => this.#receive(e.detail))
    conn.addEventListener('snapshot', (e) => this.#receive(e.detail))
    conn.addEventListener('pong', (e) => lagger.delay(() => (this.stats.rtt = performance.now() - e.detail.t)))
    this.pingTimer = setInterval(() => this.#send(JSON.stringify({ v: 1, type: 'ping', t: performance.now() })), 1000)
  }

  #send(data) {
    this._bytes.out += typeof data === 'string' ? data.length : data.byteLength
    this.lagger.delay(() => this.conn.send(data))
  }

  #receive(raw) {
    const size = typeof raw === 'string' ? raw.length : raw.byteLength
    this.lagger.delay(() => {
      this._bytes.in += size
      let snap
      try {
        snap = this.codec.decodeSnapshot(raw)
      } catch (e) {
        console.warn('bad snapshot', e)
        return
      }
      this.#onSnapshot(snap)
    })
  }

  #onSnapshot(snap) {
    if (snap.tick <= this.lastTick) return // late (reordered) snapshot: a newer one already arrived
    this.lastTick = snap.tick
    const now = performance.now()

    // clock: arrival time minus server time. The smallest sample is the least delayed one.
    const sample = now - snap.tick * TICK_MS
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample
    else this.clockOffset += (sample - this.clockOffset) * 0.002 // follow slow drift upwards

    const entities = new Map(snap.entities.map((e) => [e.id, e]))
    this.buffer.push({ time: snap.tick * TICK_MS, arrived: now, tick: snap.tick, entities })
    if (this.buffer.length > BUFFER) this.buffer.shift()

    // --- my ship: reconcile ---
    const mine = snap.entities.find((e) => e.kind === 'ship' && e.playerId === this.myId)
    this.myShip = mine ?? null
    this.myFlags = mine?.flags ?? 0
    if (!mine || mine.flags & ShipFlag.DEAD) {
      this.predicted = null
      this.pending = this.pending.filter((p) => p.seq > snap.ack)
    } else {
      const server = { pos: new Vector2(mine.x, mine.y), vel: new Vector2(mine.vx, mine.vy), angle: mine.angle }
      const r = reconcile(server, this.pending, snap.ack, DT, this.stepFn)
      if (this.predicted) {
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
    const serverMine = new Set(snap.entities.filter((e) => e.kind === 'bullet' && e.owner === this.myId).map((e) => e.seq))
    this.bullets = this.bullets.filter((b) => {
      if (serverMine.has(b.seq)) b.confirmed = true
      else if (b.confirmed) return false // server bullet is gone (hit something)
      else if (now - b.born > 400 + this.stats.rtt) return false // server never fired it
      return true
    })

    // --- events -> effects + bus (audio, HUD) ---
    for (const ev of snap.events) {
      if (ev.type === 'exploded') this.#explosion(ev.x, ev.y, ev.kind === 'ship' ? '#ffb347' : '#b8a58a')
      if (ev.type === 'fired' && ev.playerId === this.myId) continue // already played locally
      this.bus.dispatchEvent(new CustomEvent(ev.type, { detail: ev }))
    }
  }

  #explosion(x, y, color) {
    const pos = new Vector2(x, y)
    this.effects.push({
      kind: 'explosion',
      pos,
      prevPos: pos,
      angle: 0,
      prevAngle: 0,
      color,
      life: 0.7,
      particles: Array.from({ length: 18 }, () => ({
        offset: new Vector2(),
        vel: Vector2.fromAngle(this.rng.range(0, Math.PI * 2), this.rng.range(40, 220)),
      })),
    })
  }

  /** One client simulation step (30 Hz): send the input, predict my ship and bullets. */
  step(controls) {
    if (!this.myId) return
    this.seq++
    this.#send(this.codec.encodeInput({ seq: this.seq, bits: controlsToBits(controls) }))
    if (this.predicted && this.predict) {
      this.prevPredicted = this.predicted
      this.predicted = this.stepFn(this.predicted, controls, DT)
      this.pending.push({ seq: this.seq, controls })
      // bullet prediction: same cooldown rule as the server
      this.cooldown = Math.max(0, this.cooldown - DT)
      if (controls.fire && this.cooldown === 0) {
        const s = this.predicted
        const nose = s.pos.add(Vector2.fromAngle(s.angle, 18))
        this.bullets.push({
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
        this.bus.dispatchEvent(new CustomEvent('fired', { detail: { playerId: this.myId } }))
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

  /** Called every render frame. Returns drawable view objects. */
  view(alpha, dtFrame) {
    const now = performance.now()
    // decay the correction offset smoothly over ~SMOOTH_MS
    const k = Math.exp(-(dtFrame * 1000) / (SMOOTH_MS / 3))
    this.smooth.x *= k
    this.smooth.y *= k

    const out = []
    const renderTime = now - (this.clockOffset ?? 0) - this.interpDelay
    let a = null
    let b = null
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].time <= renderTime) {
        a = this.buffer[i]
        b = this.buffer[i + 1] ?? null
        break
      }
    }
    if (!a) a = this.buffer[0] // not enough history yet
    const t = a && b ? Math.min(1, (renderTime - a.time) / (b.time - a.time)) : 0

    if (a) {
      for (const ea of a.entities.values()) {
        if (ea.kind === 'ship' && ea.playerId === this.myId && this.predict) continue
        if (ea.kind === 'bullet' && ea.owner === this.myId && this.bullets.some((p) => p.seq === ea.seq)) continue
        const eb = b?.entities.get(ea.id)
        if (b && !eb) continue // gone in the next snapshot: it died
        const s = eb ?? ea
        const x = eb ? lerpWrap(ea.x, eb.x, t, ARENA.width) : ea.x
        const y = eb ? lerpWrap(ea.y, eb.y, t, ARENA.height) : ea.y
        const angle = ea.angle === undefined ? Math.atan2(s.vy, s.vx) : eb ? lerpAngle(ea.angle, eb.angle, t) : ea.angle
        out.push(this.#viewEntity(s, x, y, angle))
      }
    }

    if (this.predicted && this.myShip && this.predict) {
      const p0 = this.prevPredicted ?? this.predicted
      const p1 = this.predicted
      const x = lerpWrap(p0.pos.x, p1.pos.x, alpha, ARENA.width) + this.smooth.x
      const y = lerpWrap(p0.pos.y, p1.pos.y, alpha, ARENA.height) + this.smooth.y
      out.push(this.#viewEntity(this.myShip, x, y, lerpAngle(p0.angle, p1.angle, alpha)))
    }
    for (const bl of this.bullets) {
      const x = lerpWrap(bl.prevPos.x, bl.pos.x, alpha, ARENA.width)
      const y = lerpWrap(bl.prevPos.y, bl.pos.y, alpha, ARENA.height)
      out.push(this.#viewEntity({ kind: 'bullet', homing: bl.homing }, x, y, Math.atan2(bl.vel.y, bl.vel.x)))
    }

    for (const fx of this.effects) {
      fx.life -= dtFrame
      for (const p of fx.particles) p.offset = p.offset.add(p.vel.scale(dtFrame))
    }
    this.effects = this.effects.filter((fx) => fx.life > 0)
    out.push(...this.effects)

    const latest = this.buffer[this.buffer.length - 1]
    this.stats.snapshotAge = latest ? now - latest.arrived : 0
    if (now - this._bytes.at >= 1000) {
      const secs = (now - this._bytes.at) / 1000
      this.stats.downBps = this._bytes.in / secs
      this.stats.upBps = this._bytes.out / secs
      this._bytes = { in: 0, out: 0, at: now }
    }
    return out
  }

  /** Snapshot entity -> object the Lab 2 renderer understands (pos/prevPos/angle/…). */
  #viewEntity(e, x, y, angle) {
    const pos = new Vector2(x, y)
    const base = { kind: e.kind, pos, prevPos: pos, angle, prevAngle: angle, behaviors: e.homing ? [1] : [] }
    if (e.kind === 'ship') {
      const info = this.players.get(e.playerId)
      const mine = e.playerId === this.myId
      return {
        ...base,
        radius: 14,
        name: info?.name ?? `#${e.playerId}`,
        color: mine ? '#5ec8ff' : '#ff8a65',
        hp: e.hp,
        dead: (e.flags & ShipFlag.DEAD) !== 0,
        shield: e.flags & ShipFlag.SHIELD ? 1 : 0,
        thrust: (e.flags & ShipFlag.THRUST) !== 0,
      }
    }
    if (e.kind === 'asteroid') return { ...base, radius: e.radius }
    if (e.kind === 'pickup') return { ...base, radius: 12, effect: e.effect, angle: now() / 1000 }
    return { ...base, radius: 3 }
  }

  get myScore() {
    return this.myShip?.score ?? 0
  }

  destroy() {
    clearInterval(this.pingTimer)
  }
}

const now = () => performance.now()

/**
 * Lab 5 M2 experiment (?breakdet=1): what happens if integrate() is not deterministic,
 * e.g. someone adds Math.random() to it. Client and server physics no longer agree.
 */
function nondeterministicStep(state, controls, dt) {
  const n = stepShipState(state, controls, dt)
  return { ...n, pos: n.pos.add(n.vel.scale(dt * (Math.random() - 0.5) * 0.3)) }
}
