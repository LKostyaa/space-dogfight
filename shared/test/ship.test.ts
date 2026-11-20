import { describe, it, expect } from 'vitest'
import { integrate, stepShipState, MAX_SPEED, TURN, THRUST, type ShipState } from '../src/sim/ship.ts'
import { ARENA } from '../src/sim/arena.ts'
import { DT } from '../src/sim/constants.ts'
import { controls, v } from './helpers.ts'

const rest: ShipState = { pos: v(100, 100), vel: v(0, 0), angle: 0 }

describe('ship physics (integrate)', () => {
  it('no input, no velocity -> stays put', () => {
    const s = integrate(rest, controls(), DT)
    expect(s.pos).toEqual(rest.pos)
    expect(s.angle).toBe(0)
  })
  it('left/right rotate by TURN·dt', () => {
    expect(integrate(rest, controls({ left: true }), DT).angle).toBeCloseTo(-TURN * DT, 10)
    expect(integrate(rest, controls({ right: true }), DT).angle).toBeCloseTo(TURN * DT, 10)
  })
  it('thrust accelerates along the heading', () => {
    const s = integrate(rest, controls({ thrust: true }), DT)
    expect(s.vel.x).toBeGreaterThan(0)
    expect(s.vel.x).toBeLessThan(THRUST * DT + 1e-9)
    expect(s.vel.y).toBeCloseTo(0, 10)
  })
  it('drag slows a coasting ship down', () => {
    const s = integrate({ ...rest, vel: v(100, 0) }, controls(), DT)
    expect(s.vel.x).toBeLessThan(100)
    expect(s.vel.x).toBeGreaterThan(90)
  })
  it('speed never exceeds MAX_SPEED', () => {
    let s = rest
    for (let i = 0; i < 300; i++) s = integrate(s, controls({ thrust: true }), DT)
    expect(s.vel.length()).toBeLessThanOrEqual(MAX_SPEED + 1e-9)
  })
  it('stepShipState wraps around the arena edge', () => {
    const s = stepShipState({ pos: v(ARENA.width - 1, 10), vel: v(300, 0), angle: 0 }, controls(), DT)
    expect(s.pos.x).toBeLessThan(20)
  })
})
