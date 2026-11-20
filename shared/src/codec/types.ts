import type { CodecName, InputMsg, Snapshot } from '../protocol.ts'

/** What travels over the WebSocket: text frames or binary frames. */
export type Wire = string | ArrayBuffer

/** Two implementations (json, binary), one interface — switching is a flag. */
export interface Codec {
  readonly name: CodecName
  encodeSnapshot(snap: Snapshot): Wire
  /** Throws CodecError on anything malformed — never anything else. */
  decodeSnapshot(data: Wire): Snapshot
  encodeInput(input: InputMsg): Wire
  decodeInput(data: Wire): InputMsg
}
