import { z } from 'zod'
import { PROTOCOL_VERSION, SnapshotSchema, ClientMessageSchema, type Snapshot, type InputMsg } from '../protocol.ts'
import { CodecError } from './errors.ts'
import type { Codec, Wire } from './types.ts'
import type { WorldSnapshot } from '../net/snapshot.ts'
import type { Seq } from '../types.ts'

const SnapshotMessage = SnapshotSchema.extend({ v: z.literal(PROTOCOL_VERSION), type: z.literal('snapshot') })

function parse(data: Wire): unknown {
  if (typeof data !== 'string') throw new CodecError('json codec expects text')
  try {
    return JSON.parse(data)
  } catch {
    throw new CodecError('not json')
  }
}

/** Plain JSON codec — kept behind a flag for the JSON-vs-binary comparison. */
export const jsonCodec: Codec = {
  name: 'json',
  encodeSnapshot(snap: Snapshot): string {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'snapshot', ...snap })
  },
  prepareSnapshot(snap: WorldSnapshot) {
    // {"v":1,"type":"snapshot","ack":N, + the rest serialized once
    const rest = JSON.stringify({ tick: snap.tick, entities: snap.entities, events: snap.events }).slice(1)
    return (ack: Seq) => `{"v":${PROTOCOL_VERSION},"type":"snapshot","ack":${ack},${rest}`
  },
  decodeSnapshot(data: Wire): Snapshot {
    const r = SnapshotMessage.safeParse(parse(data))
    if (!r.success) throw new CodecError(`bad snapshot: ${r.error.issues[0]?.message ?? '?'}`)
    const { tick, ack, entities, events } = r.data
    return { tick, ack, entities, events }
  },
  encodeInput({ seq, bits }: InputMsg): string {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', seq, b: bits })
  },
  decodeInput(data: Wire): InputMsg {
    const r = ClientMessageSchema.safeParse(parse(data))
    if (!r.success || r.data.type !== 'input') throw new CodecError('bad input')
    return { seq: r.data.seq, bits: r.data.b }
  },
}
