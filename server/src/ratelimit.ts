export interface TokenBucket {
  take(n?: number): boolean
  readonly tokens: number
}

export function createTokenBucket({ rate, burst, now = () => performance.now() }: { rate: number; burst: number; now?: () => number }): TokenBucket {
  let tokens = burst
  let last = now()
  return {
    take(n = 1) {
      const t = now()
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate)
      last = t
      if (tokens < n) return false
      tokens -= n
      return true
    },
    get tokens() {
      return tokens
    },
  }
}
