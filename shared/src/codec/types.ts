import type { CodecName, InputMsg, Snapshot } from '../protocol.ts'
import type { WorldSnapshot } from '../net/snapshot.ts'
import type { Seq } from '../types.ts'

/** What travels over the WebSocket: text frames or binary frames. */
export type Wire = string | ArrayBuffer

export interface Codec {
  readonly name: CodecName
  encodeSnapshot(snap: Snapshot): Wire
  prepareSnapshot(snap: WorldSnapshot): (ack: Seq) => Wire
  /** Throws CodecError on anything malformed — never anything else. */
  decodeSnapshot(data: Wire): Snapshot
  encodeInput(input: InputMsg): Wire
  decodeInput(data: Wire): InputMsg
}
