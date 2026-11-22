export const Close = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  BAD_MESSAGE: 4000,
  JOIN_TIMEOUT: 4001,
  RATE_LIMIT: 4002,
  ROOM_FULL: 4003,
  TOO_SLOW: 4004,
  SERVER_FULL: 4005,
} as const

export type CloseCode = (typeof Close)[keyof typeof Close]
