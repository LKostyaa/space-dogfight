/**
 * Token bucket: `rate` tokens per second, at most `burst` saved up.
 * take() returns false when the client is over the limit.
 */
export function createTokenBucket({ rate, burst, now = () => performance.now() }) {
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
