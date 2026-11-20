import { describe, it, expect } from 'vitest'
import { Vector2 } from '../src/sim/vector.ts'

describe('Vector2', () => {
  it('add / sub / scale return new vectors and never mutate', () => {
    const a = new Vector2(1, 2)
    const b = new Vector2(3, 4)
    expect(a.add(b)).toEqual(new Vector2(4, 6))
    expect(a.sub(b)).toEqual(new Vector2(-2, -2))
    expect(a.scale(3)).toEqual(new Vector2(3, 6))
    expect(a).toEqual(new Vector2(1, 2))
  })
  it('length and dot', () => {
    expect(new Vector2(3, 4).length()).toBe(5)
    expect(new Vector2(1, 2).dot(new Vector2(3, 4))).toBe(11)
  })
  it('normalize gives a unit vector, and the zero vector stays zero', () => {
    expect(new Vector2(10, 0).normalize()).toEqual(new Vector2(1, 0))
    expect(new Vector2(3, 4).normalize().length()).toBeCloseTo(1, 10)
    expect(new Vector2().normalize()).toEqual(new Vector2(0, 0))
  })
  it('rotate by 90° turns x into y', () => {
    const r = new Vector2(1, 0).rotate(Math.PI / 2)
    expect(r.x).toBeCloseTo(0, 10)
    expect(r.y).toBeCloseTo(1, 10)
  })
  it('fromAngle builds a vector of the given length', () => {
    const f = Vector2.fromAngle(Math.PI, 2)
    expect(f.x).toBeCloseTo(-2, 10)
    expect(f.y).toBeCloseTo(0, 10)
  })
  it('clampLength only shortens', () => {
    expect(new Vector2(30, 40).clampLength(5).length()).toBeCloseTo(5, 10)
    const short = new Vector2(1, 1)
    expect(short.clampLength(5)).toBe(short)
  })
})
