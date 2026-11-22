const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export const puzzles = {
  // 1. sync code, then ALL microtasks, then the next task
  basic(log) {
    log('A')
    setTimeout(() => log('B'))
    Promise.resolve().then(() => log('C'))
    log('D')
  },
  // 2. everything after `await` is a microtask continuation
  awaitSplit(log) {
    async function f() {
      log('f1')
      await null
      log('f2')
    }
    log('start')
    f()
    log('end')
  },
  timeoutInThen(log) {
    setTimeout(() => log('t0'))
    Promise.resolve().then(() => {
      setTimeout(() => log('t1'))
      log('p1')
    })
    Promise.resolve().then(() => log('p2'))
  },
  raf(log) {
    requestAnimationFrame(() => log('raf'))
    setTimeout(() => log('timeout'))
    queueMicrotask(() => log('micro'))
    log('sync')
  },
  // 5. two promise chains interleave one link at a time
  interleave(log) {
    Promise.resolve()
      .then(() => log('a1'))
      .then(() => log('a2'))
    Promise.resolve()
      .then(() => log('b1'))
      .then(() => log('b2'))
  },
}

export async function runAll() {
  const results = {}
  for (const [name, fn] of Object.entries(puzzles)) {
    const out = []
    fn((x) => out.push(x))
    await wait(100)
    results[name] = out.join(' ')
  }
  console.table(results)
  return results
}
