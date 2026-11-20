/**
 * Protocol v1 (Lab 5). JSON control messages (join, chat, ping, roster…) plus
 * two hot-path messages that go through a Codec (JSON or binary):
 *   input    client -> server, every simulation step
 *   snapshot server -> client, every server tick
 * The binary layout is specified in docs/protocol.md.
 */
export const PROTOCOL_VERSION = 1

export const BinaryType = Object.freeze({ SNAPSHOT: 1, INPUT: 2 })

export const Buttons = Object.freeze({ LEFT: 1, RIGHT: 2, THRUST: 4, FIRE: 8 })

export function controlsToBits(c) {
  return (c.left ? Buttons.LEFT : 0) | (c.right ? Buttons.RIGHT : 0) | (c.thrust ? Buttons.THRUST : 0) | (c.fire ? Buttons.FIRE : 0)
}

export function bitsToControls(b) {
  return {
    left: (b & Buttons.LEFT) !== 0,
    right: (b & Buttons.RIGHT) !== 0,
    thrust: (b & Buttons.THRUST) !== 0,
    fire: (b & Buttons.FIRE) !== 0,
  }
}

export const KIND_CODE = Object.freeze({ ship: 1, bullet: 2, asteroid: 3, pickup: 4 })
export const KIND_NAME = Object.freeze(['', 'ship', 'bullet', 'asteroid', 'pickup'])

export const EVENT_CODE = Object.freeze({ fired: 1, hit: 2, exploded: 3, pickup: 4 })
export const EVENT_NAME = Object.freeze(['', 'fired', 'hit', 'exploded', 'pickup'])

export const EFFECTS = Object.freeze(['shield', 'rapid', 'homing'])

/** Ship flag bits in snapshots. */
export const ShipFlag = Object.freeze({ THRUST: 1, SHIELD: 2, RAPID: 4, HOMING: 8, DEAD: 16 })
