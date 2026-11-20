import { describe, it, expect, afterEach } from 'vitest'
import { withRetry, HttpError, loadAll, fetchJson } from '../src/assets/loader.ts'

const realFetch = globalThis.fetch

describe('asset loading', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('withRetry never retries a 4xx', async () => {
    let calls = 0
    const fail = () => {
      calls++
      return Promise.reject(new HttpError(404, '/x'))
    }
    await expect(withRetry(fail, { attempts: 3, baseMs: 1 })).rejects.toThrow(HttpError)
    expect(calls).toBe(1)
  })
  it('withRetry retries a 5xx and then succeeds', async () => {
    let calls = 0
    const flaky = () => (++calls < 3 ? Promise.reject(new HttpError(503, '/x')) : Promise.resolve('ok'))
    await expect(withRetry(flaky, { attempts: 3, baseMs: 1 })).resolves.toBe('ok')
    expect(calls).toBe(3)
  })
  it('withRetry stops immediately when aborted', async () => {
    const c = new AbortController()
    c.abort(new DOMException('stop', 'AbortError'))
    await expect(withRetry(() => Promise.resolve(1), { signal: c.signal })).rejects.toThrow('stop')
  })
  it('loadAll: an optional item that fails is reported, the rest still loads', async () => {
    const progress: number[] = []
    const r = await loadAll(
      [
        { key: 'a', load: () => Promise.resolve(1) },
        { key: 'b', load: () => Promise.reject(new HttpError(404, '/b')), required: false },
      ],
      { onProgress: (p) => progress.push(p.done) },
    )
    expect(r.assets.get('a')).toBe(1)
    expect(r.errors.map((e) => e.key)).toEqual(['b'])
    expect(progress.sort()).toEqual([1, 2])
  })
  it('fetchJson checks res.ok and reports corrupt JSON clearly', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('{nope', { status: 200 }))
    await expect(fetchJson('/arena.json')).rejects.toThrow('Corrupt JSON')
    globalThis.fetch = () => Promise.resolve(new Response('missing', { status: 404 }))
    await expect(fetchJson('/arena.json')).rejects.toThrow(HttpError)
  })
})
