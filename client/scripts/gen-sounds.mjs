import { writeFileSync } from 'node:fs'

const RATE = 22050

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(RATE, 24)
  h.writeUInt32LE(RATE * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

function make(seconds, fn) {
  const n = Math.floor(seconds * RATE)
  let seed = 7
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  return Array.from({ length: n }, (_, i) => fn(i / RATE, i / n, noise))
}

const out = new URL('../public/assets/sfx/', import.meta.url)
const sounds = {
  shoot: make(0.12, (t, p) => Math.sin(2 * Math.PI * (900 - 600 * p) * t) * (1 - p) * 0.4),
  hit: make(0.1, (t, p, n) => (n() * 0.5 + Math.sin(2 * Math.PI * 220 * t) * 0.5) * (1 - p) * 0.5),
  explosion: make(0.6, (t, p, n) => n() * Math.pow(1 - p, 2) * 0.7),
  pickup: make(0.25, (t, p) => Math.sin(2 * Math.PI * (500 + 700 * p) * t) * (1 - p) * 0.35),
}
for (const [name, s] of Object.entries(sounds)) writeFileSync(new URL(`${name}.wav`, out), wav(s))
console.log('ok', Object.keys(sounds))
