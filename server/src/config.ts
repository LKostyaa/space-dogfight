import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def)

export const ServerConfigSchema = z.object({
  PORT: int(3000, 0, 65535),
  HOST: z.string().default('0.0.0.0'),
  LOG_DIR: z.string().default(path.join(here, '../../logs')),
  STATIC_DIR: z.string().default(path.join(here, '../../client/dist')),
  MAX_ROOMS: int(20, 1),
  MAX_PLAYERS_PER_ROOM: int(8, 1, 64),
  MAX_PAYLOAD: int(4096, 64),
  MSG_RATE: int(60, 1), // 30 inputs/s + chat + pings
  MSG_BURST: int(120, 1),
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  MAX_CONNECTIONS_PER_IP: int(8, 1),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type ServerConfig = Readonly<{
  port: number
  host: string
  logDir: string
  staticDir: string
  maxRooms: number
  maxPlayersPerRoom: number
  maxPayload: number
  msgRate: number
  msgBurst: number
  allowedOrigins: readonly string[]
  maxConnectionsPerIp: number
  trustProxy: boolean
  logLevel: string
}>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const r = ServerConfigSchema.safeParse(env)
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid configuration:\n${lines}`)
  }
  const c = r.data
  return Object.freeze({
    port: c.PORT,
    host: c.HOST,
    logDir: path.resolve(c.LOG_DIR),
    staticDir: path.resolve(c.STATIC_DIR),
    maxRooms: c.MAX_ROOMS,
    maxPlayersPerRoom: c.MAX_PLAYERS_PER_ROOM,
    maxPayload: c.MAX_PAYLOAD,
    msgRate: c.MSG_RATE,
    msgBurst: c.MSG_BURST,
    allowedOrigins: c.ALLOWED_ORIGINS,
    maxConnectionsPerIp: c.MAX_CONNECTIONS_PER_IP,
    trustProxy: c.TRUST_PROXY,
    logLevel: c.LOG_LEVEL,
  })
}
