import { describe, it, expect } from 'vitest'
import { PlayerIdPool } from '../src/ids.ts'

describe('player id pool (1 byte on the wire)', () => {
  it('hands out the smallest free id and reuses released ones', () => {
    const pool = new PlayerIdPool(3)
    expect([pool.take(), pool.take()]).toEqual([1, 2])
    const two = pool.take()
    expect(two).toBe(3)
    expect(pool.take()).toBeNull()
    if (two !== null) pool.release(two)
    expect(pool.take()).toBe(3)
  })
  it('counts ids in use', () => {
    const pool = new PlayerIdPool()
    pool.take()
    pool.take()
    expect(pool.size).toBe(2)
  })
})
