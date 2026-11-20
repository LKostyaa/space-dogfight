import { jsonCodec } from './json.ts'
import { binaryCodec } from './binary.ts'
import type { Codec } from './types.ts'
import type { CodecName } from '../protocol.ts'

export { CodecError } from './errors.ts'
export type { Codec, Wire } from './types.ts'
export { jsonCodec, binaryCodec }

export const codecs: Readonly<Record<CodecName, Codec>> = { json: jsonCodec, binary: binaryCodec }

export function getCodec(name: CodecName): Codec {
  return codecs[name]
}
