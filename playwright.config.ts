import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3100',
    // local runs can point at an installed Chrome; CI uses `npx playwright install chromium`
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  webServer: {
    // serves the built client (npm run build) from the game server
    command: 'node server/src/index.ts',
    url: 'http://localhost:3100/health',
    env: { PORT: '3100', LOG_DIR: 'test-results/logs' },
    reuseExistingServer: !process.env.CI,
  },
})
