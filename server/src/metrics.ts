import { performance } from 'node:perf_hooks'
import type { RoomManager } from './rooms.ts'

export type RejectReason =
  | 'origin'
  | 'ip_cap'
  | 'rate_limit'
  | 'bad_message'
  | 'join_timeout'
  | 'room_full'
  | 'server_full'
  | 'too_slow'

export interface NetCounters {
  bytesOut: number
  bytesIn: number
  messagesIn: number
  messagesOut: number
  connections: number
  readonly rejected: Map<RejectReason, number>
}

export function createCounters(): NetCounters {
  return { bytesOut: 0, bytesIn: 0, messagesIn: 0, messagesOut: 0, connections: 0, rejected: new Map() }
}

export function reject(c: NetCounters, reason: RejectReason): void {
  c.rejected.set(reason, (c.rejected.get(reason) ?? 0) + 1)
}

export function createMetrics(counters: NetCounters, rooms: RoomManager) {
  let lastElu = performance.eventLoopUtilization()
  let last = { t: performance.now(), msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0 }

  return function render(): string {
    const now = performance.now()
    const secs = Math.max(0.001, (now - last.t) / 1000)
    const elu = performance.eventLoopUtilization(lastElu)
    lastElu = performance.eventLoopUtilization()
    const rate = {
      msgIn: (counters.messagesIn - last.msgIn) / secs,
      msgOut: (counters.messagesOut - last.msgOut) / secs,
      bytesIn: (counters.bytesIn - last.bytesIn) / secs,
      bytesOut: (counters.bytesOut - last.bytesOut) / secs,
    }
    last = { t: now, msgIn: counters.messagesIn, msgOut: counters.messagesOut, bytesIn: counters.bytesIn, bytesOut: counters.bytesOut }

    const list = rooms.list()
    let players = 0
    let bots = 0
    const lines: string[] = []
    const metric = (name: string, type: 'gauge' | 'counter', help: string, samples: [string, number][]): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
      for (const [labels, value] of samples) lines.push(`${name}${labels} ${Number.isFinite(value) ? value : 0}`)
    }
    const tick: [string, number][] = []
    for (const r of list) {
      const s = r.match?.stats()
      if (!s) continue
      players += s.players
      bots += s.bots
      if (s.players > 0) tick.push([`{room="${r.id}",quantile="0.99"}`, s.tickMs.p99 / 1000])
    }
    metric('dogfight_players', 'gauge', 'Connected players (incl. bots)', [['', players]])
    metric('dogfight_bots', 'gauge', 'Server-side bots', [['', bots]])
    metric('dogfight_rooms', 'gauge', 'Rooms', [['', list.length]])
    metric('dogfight_connections', 'gauge', 'Open WebSocket connections', [['', counters.connections]])
    metric('dogfight_messages_in_total', 'counter', 'WebSocket messages received', [['', counters.messagesIn]])
    metric('dogfight_messages_out_total', 'counter', 'WebSocket messages sent', [['', counters.messagesOut]])
    metric('dogfight_bytes_in_total', 'counter', 'Bytes received', [['', counters.bytesIn]])
    metric('dogfight_bytes_out_total', 'counter', 'Bytes sent', [['', counters.bytesOut]])
    metric('dogfight_messages_per_second', 'gauge', 'Messages/s since the last scrape', [['{dir="in"}', rate.msgIn], ['{dir="out"}', rate.msgOut]])
    metric('dogfight_bytes_per_second', 'gauge', 'Bytes/s since the last scrape', [['{dir="in"}', rate.bytesIn], ['{dir="out"}', rate.bytesOut]])
    metric('dogfight_tick_seconds', 'gauge', 'Tick duration p99 per room (last 10 s)', tick)
    metric('dogfight_event_loop_utilization', 'gauge', 'Share of time the event loop was busy since the last scrape', [['', elu.utilization]])
    metric('dogfight_rss_bytes', 'gauge', 'Resident set size', [['', process.memoryUsage().rss]])
    metric('dogfight_rejected_total', 'counter', 'Rejected/closed connections by reason', [...counters.rejected].map(([reason, n]): [string, number] => [`{reason="${reason}"}`, n]))
    return lines.join('\n') + '\n'
  }
}
