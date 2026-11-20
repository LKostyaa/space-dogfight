import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { originAllowed, clientIp } from '../src/ws.ts'

describe('handshake checks', () => {
  it('Origin: only listed origins (or localhost in dev); non-browser clients without Origin pass', () => {
    const prod = ['https://dogfight.example.com']
    expect(originAllowed('https://dogfight.example.com', prod)).toBe(true)
    expect(originAllowed('https://evil.example', prod)).toBe(false)
    expect(originAllowed('http://localhost:5173', [])).toBe(true)
    expect(originAllowed('https://evil.example', [])).toBe(false)
    expect(originAllowed(undefined, prod)).toBe(true)
  })
  it('client IP comes from X-Forwarded-For only behind a trusted proxy', () => {
    const socket = new Socket()
    Object.defineProperty(socket, 'remoteAddress', { value: '10.0.0.1' })
    const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket } satisfies Pick<IncomingMessage, 'headers' | 'socket'>
    expect(clientIp(req, true)).toBe('203.0.113.7')
    expect(clientIp(req, false)).toBe('10.0.0.1')
  })
})
