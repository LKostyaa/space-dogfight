import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.ts'

describe('config (zod)', () => {
  it('uses defaults and coerces numbers from strings', () => {
    const c = loadConfig({ PORT: '8080' })
    expect(c.port).toBe(8080)
    expect(c.maxPlayersPerRoom).toBe(8)
  })
  it('fails fast with a readable message on bad values', () => {
    expect(() => loadConfig({ MAX_ROOMS: 'abc' })).toThrow('MAX_ROOMS')
    expect(() => loadConfig({ PORT: '70000' })).toThrow('PORT')
  })
})
