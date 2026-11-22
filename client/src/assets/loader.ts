export class HttpError extends Error {
  readonly status: number
  readonly url: string
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })

export interface LoadOptions {
  signal?: AbortSignal | undefined
}

export async function withRetry<T>(fn: () => Promise<T>, { attempts = 3, baseMs = 200, signal }: { attempts?: number; baseMs?: number } & LoadOptions = {}): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted()
    try {
      return await fn()
    } catch (e: unknown) {
      lastError = e
      const clientError = e instanceof HttpError && e.status >= 400 && e.status < 500
      if (clientError || isAbort(e) || signal?.aborted) throw e
      if (i < attempts - 1) await sleep(Math.random() * baseMs * 2 ** i, signal)
    }
  }
  throw lastError
}

export async function fetchChecked(url: string, { signal }: LoadOptions = {}): Promise<Response> {
  const res = await fetch(url, signal ? { signal } : {})
  if (!res.ok) throw new HttpError(res.status, url)
  return res
}

export async function fetchJson(url: string, opts: LoadOptions = {}): Promise<unknown> {
  const text = await (await fetchChecked(url, opts)).text()
  try {
    return JSON.parse(text)
  } catch {
    throw new SyntaxError(`Corrupt JSON in ${url}`)
  }
}

export const loadJson = (url: string, opts: LoadOptions = {}): Promise<unknown> => withRetry(() => fetchJson(url, opts), opts)

export function loadImage(url: string, opts: LoadOptions = {}): Promise<HTMLImageElement> {
  return withRetry(async () => {
    const blob = await (await fetchChecked(url, opts)).blob()
    const img = new Image()
    img.src = URL.createObjectURL(blob)
    await img.decode()
    return img
  }, opts)
}

export function loadAudio(ctx: BaseAudioContext, url: string, opts: LoadOptions = {}): Promise<AudioBuffer> {
  return withRetry(async () => ctx.decodeAudioData(await (await fetchChecked(url, opts)).arrayBuffer()), opts)
}

export interface LoadItem<T = unknown> {
  readonly key: string
  readonly load: (opts: LoadOptions) => Promise<T>
  readonly required?: boolean
}

export interface LoadError {
  readonly key: string
  readonly message: string
}

export interface LoadResult {
  readonly assets: ReadonlyMap<string, unknown>
  readonly errors: readonly LoadError[]
}

export type ProgressFn = (p: { done: number; total: number; key: string }) => void

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export async function loadAll(items: readonly LoadItem[], { onProgress = () => {}, signal }: { onProgress?: ProgressFn } & LoadOptions = {}): Promise<LoadResult> {
  let done = 0
  const errors: LoadError[] = []
  const results = await Promise.all(
    items.map(async (item): Promise<[string, unknown]> => {
      try {
        return [item.key, await item.load({ signal })]
      } catch (e: unknown) {
        if (item.required !== false || signal?.aborted) throw e
        errors.push({ key: item.key, message: message(e) })
        return [item.key, null]
      } finally {
        onProgress({ done: ++done, total: items.length, key: item.key })
      }
    }),
  )
  return { assets: new Map(results), errors }
}

export async function loadSequential(items: readonly LoadItem[], { onProgress = () => {}, signal }: { onProgress?: ProgressFn } & LoadOptions = {}): Promise<LoadResult> {
  const assets = new Map<string, unknown>()
  let done = 0
  for (const item of items) {
    assets.set(item.key, await item.load({ signal }))
    onProgress({ done: ++done, total: items.length, key: item.key })
  }
  return { assets, errors: [] }
}
