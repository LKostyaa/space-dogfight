// What the e2e test reads from the page (exposed by client/src/main.ts for debugging/tests).
export {}
interface SnapEntity {
  kind: string
  playerId?: number
  x: number
  y: number
}
declare global {
  interface Window {
    __game?: {
      myId: number
      players: Map<number, { name: string }>
      buffer: { entities: Map<number, SnapEntity> }[]
    }
  }
}
