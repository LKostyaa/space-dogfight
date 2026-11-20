import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function int(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Config: ${name} must be an integer in [${min}, ${max}], got "${raw}"`)
  }
  return n
}

/** All settings come from the environment (12-factor). Invalid values fail at startup. */
export function loadConfig() {
  return Object.freeze({
    port: int('PORT', 3000, { min: 0, max: 65535 }),
    host: process.env.HOST || '0.0.0.0',
    logDir: path.resolve(process.env.LOG_DIR || path.join(here, '../../logs')),
    staticDir: path.resolve(process.env.STATIC_DIR || path.join(here, '../../client/dist')),
    maxRooms: int('MAX_ROOMS', 20, { min: 1 }),
    maxPlayersPerRoom: int('MAX_PLAYERS_PER_ROOM', 8, { min: 1, max: 64 }),
    maxPayload: int('MAX_PAYLOAD', 4096, { min: 64 }),
    msgRate: int('MSG_RATE', 30, { min: 1 }),
    msgBurst: int('MSG_BURST', 60, { min: 1 }),
  })
}
