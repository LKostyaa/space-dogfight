import { test, expect, type Page, type Browser } from '@playwright/test'

async function join(browser: Browser, name: string, room = 'duel'): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/?netgraph=0')
  await page.locator('#pilot').fill(name)
  await page.locator(`button[data-room="${room}"]`).click()
  return page
}

function shipOf(viewer: Page, name: string) {
  return viewer.evaluate((n) => {
    const g = window.__game
    if (!g) return null
    const id = [...g.players].find(([, p]) => p.name === n)?.[0]
    const latest = g.buffer.at(-1)
    for (const e of latest?.entities.values() ?? []) if (e.kind === 'ship' && e.playerId === id) return { x: e.x, y: e.y }
    return null
  }, name)
}

test('two players: roster, movement seen by the other, chat', async ({ browser }) => {
  const a = await join(browser, 'Alice')
  const b = await join(browser, 'Bob')

  // roster in both windows
  await expect(a.locator('#chat-log')).toContainText('Alice, Bob')
  await expect(b.locator('#chat-log')).toContainText('Alice, Bob')

  // Alice flies; Bob must observe the movement within 500 ms
  await expect.poll(() => shipOf(b, 'Alice')).not.toBeNull()
  const before = await shipOf(b, 'Alice')
  await a.keyboard.down('ArrowUp')
  const t0 = Date.now()
  await expect
    .poll(async () => {
      const now = await shipOf(b, 'Alice')
      return now && before ? Math.hypot(now.x - before.x, now.y - before.y) : 0
    }, { timeout: 500, intervals: [25] })
    .toBeGreaterThan(1)
  const observedAfter = Date.now() - t0
  await a.keyboard.up('ArrowUp')
  expect(observedAfter).toBeLessThan(500)

  // chat
  await a.keyboard.press('Enter')
  await a.keyboard.type('gg wp')
  await a.keyboard.press('Enter')
  await expect(b.locator('#chat-log')).toContainText('Alice: gg wp')
})
