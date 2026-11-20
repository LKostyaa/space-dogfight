import { PROTOCOL_VERSION } from '../protocol/messages.js'
import { CodecError } from './errors.js'

/** Plain JSON codec — kept behind a flag for the JSON-vs-binary comparison. */
export const jsonCodec = {
  name: 'json',
  encodeSnapshot(snap) {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'snapshot', ...snap })
  },
  decodeSnapshot(data) {
    const m = parse(data)
    if (m.type !== 'snapshot' || !Array.isArray(m.entities)) throw new CodecError('not a snapshot')
    return m
  },
  encodeInput({ seq, bits }) {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: 'input', seq, b: bits })
  },
  decodeInput(data) {
    const m = parse(data)
    if (m.type !== 'input' || !Number.isInteger(m.seq) || m.seq < 0 || !Number.isInteger(m.b) || m.b < 0 || m.b > 15) {
      throw new CodecError('bad input')
    }
    return { seq: m.seq, bits: m.b }
  },
}

function parse(data) {
  if (typeof data !== 'string') throw new CodecError('json codec expects text')
  let m
  try {
    m = JSON.parse(data)
  } catch {
    throw new CodecError('not json')
  }
  if (!m || typeof m !== 'object') throw new CodecError('not an object')
  if (m.v !== PROTOCOL_VERSION) throw new CodecError(`version ${m.v}`)
  return m
}
