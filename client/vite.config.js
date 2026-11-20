import { defineConfig } from 'vite'

/**
 * Dev-only middleware: any request with ?delay=ms is answered after a pause.
 * Used to test the loading progress bar and timeouts (README "Галерея збоїв").
 */
const delayPlugin = {
  name: 'delay',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const ms = Number(new URL(req.url, 'http://x').searchParams.get('delay'))
      if (ms > 0) setTimeout(next, ms)
      else next()
    })
  },
}

export default defineConfig({
  plugins: [delayPlugin],
  server: {
    // the Node game server (npm run dev:server) runs on :3000
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
