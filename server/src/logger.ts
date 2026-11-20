import pino, { type Logger } from 'pino'

/** Git SHA baked into the image at build time (Dockerfile ARG GIT_SHA). Shown in /health and the HUD. */
export const VERSION = process.env.GIT_SHA?.slice(0, 12) || 'dev'

/**
 * Structured JSON logs to stdout (the platform collects stdout — no log files).
 * Log *events* with fields, not prose: logger.info({ roomId, playerId }, 'player.joined').
 * Never log secrets or whole client messages.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'dogfight', version: VERSION },
  redact: ['*.password', '*.token', '*.authorization', 'req.headers.cookie'],
})

export type { Logger }
