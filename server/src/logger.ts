import pino, { type Logger } from 'pino'

export const VERSION = process.env.GIT_SHA?.slice(0, 12) || 'dev'

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'dogfight', version: VERSION },
  redact: ['*.password', '*.token', '*.authorization', 'req.headers.cookie'],
})

export type { Logger }
