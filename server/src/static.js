import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

/** Serves files from `root`. Refuses anything that resolves outside it (../../etc/passwd). */
export async function serveStatic(req, res, root) {
  const url = new URL(req.url, 'http://x')
  let rel = decodeURIComponent(url.pathname)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = path.resolve(root, '.' + rel)
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('forbidden')
    return true
  }
  let info
  try {
    info = await stat(file)
  } catch {
    // SPA fallback: unknown paths without an extension get index.html
    if (path.extname(rel) === '') return serveStatic({ url: '/' }, res, root)
    return false
  }
  if (!info.isFile()) return false
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': rel.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
  })
  await pipeline(createReadStream(file), res)
  return true
}
