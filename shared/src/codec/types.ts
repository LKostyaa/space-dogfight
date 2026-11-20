import type { CodecName, InputMsg, Snapshot } from '../protocol.ts'
import type { WorldSnapshot } from '../net/snapshot.ts'
import type { Seq } from '../types.ts'

/** What travels over the WebSocket: text frames or binary frames. */
export type Wire = string | ArrayBuffer

/** Two implementations (json, binary), one interface — switching is a flag. */
export interface Codec {
  readonly name: CodecName
  encodeSnapshot(snap: Snapshot): Wire
  /**
   * Server hot path: encode the world once per tick, then produce each client's
   * copy by patching only its `ack` (Lab 7 profiling: per-client encoding was 29 % of CPU).
   */
  prepareSnapshot(snap: WorldSnapshot): (ack: Seq) => Wire
  /** Throws CodecError on anything malformed — never anything else. */
  decodeSnapshot(data: Wire): Snapshot
  encodeInput(input: InputMsg): Wire
  decodeInput(data: Wire): InputMsg
}
