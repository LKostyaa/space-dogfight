export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })

/**
 * Retries `fn` with exponential backoff + full jitter. Never retries a 4xx
 * (the file is not there — asking again will not help) or an abort.
 */
export async function withRetry(fn, { attempts = 3, baseMs = 200, signal } = {}) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted()
    try {
      return await fn()
    } catch (e) {
      lastError = e
      const clientError = e instanceof HttpError && e.status >= 400 && e.status < 500
      if (clientError || e.name === 'AbortError' || signal?.aborted) throw e
      if (i < attempts - 1) await sleep(Math.random() * baseMs * 2 ** i, signal)
    }
  }
  throw lastError
}

export async function fetchChecked(url, { signal } = {}) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new HttpError(res.status, url)
  return res
}

export async function fetchJson(url, { signal } = {}) {
  const res = await fetchChecked(url, { signal })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new SyntaxError(`Corrupt JSON in ${url}`)
  }
}

export const loadJson = (url, { signal } = {}) => withRetry(() => fetchJson(url, { signal }), { signal })

/** Image via fetch -> blob -> decode, so it can be aborted and status-checked like everything else. */
export function loadImage(url, { signal } = {}) {
  return withRetry(
    async () => {
      const blob = await (await fetchChecked(url, { signal })).blob()
      const img = new Image()
      img.src = URL.createObjectURL(blob)
      await img.decode()
      return img
    },
    { signal },
  )
}

export function loadAudio(ctx, url, { signal } = {}) {
  return withRetry(
    async () => {
      const buf = await (await fetchChecked(url, { signal })).arrayBuffer()
      return ctx.decodeAudioData(buf)
    },
    { signal },
  )
}

/**
 * Loads everything concurrently (Promise.all) with per-item progress.
 * Optional items (`required: false`) that fail are reported and skipped, so a
 * missing sprite degrades the game (fallback vector art) instead of stopping it.
 */
export async function loadAll(items, { onProgress = () => {}, signal } = {}) {
  let done = 0
  const errors = []
  const results = await Promise.all(
    items.map(async (item) => {
      try {
        const value = await item.load({ signal })
        return [item.key, value]
      } catch (e) {
        if (item.required !== false || signal?.aborted) throw e
        errors.push({ key: item.key, error: e })
        return [item.key, null]
      } finally {
        onProgress({ done: ++done, total: items.length, key: item.key })
      }
    }),
  )
  return { assets: Object.fromEntries(results), errors }
}

/** Same as loadAll, but one after another — only for the timing comparison in the README. */
export async function loadSequential(items, { onProgress = () => {}, signal } = {}) {
  const assets = {}
  let done = 0
  for (const item of items) {
    assets[item.key] = await item.load({ signal })
    onProgress({ done: ++done, total: items.length, key: item.key })
  }
  return { assets, errors: [] }
}
