import { jsonCodec } from './json.js'
import { binaryCodec } from './binary.js'

export { CodecError } from './errors.js'
export { jsonCodec, binaryCodec }

export const codecs = { json: jsonCodec, binary: binaryCodec }

export function getCodec(name) {
  return codecs[name] ?? binaryCodec
}
