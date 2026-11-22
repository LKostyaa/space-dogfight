import { EventEmitter } from 'node:events'

const mode = process.argv[2] ?? 'crash'
const socket = new EventEmitter() // stands in for a ws socket
if (mode === 'fixed') socket.on('error', (e) => console.log(`[socket] logged and closed: ${e.message}`))

setInterval(() => console.log('tick: other players still being served'), 100).unref()
setTimeout(() => socket.emit('error', new Error('ECONNRESET from one bad client')), 150)
setTimeout(() => console.log('still alive after the error'), 400)
setTimeout(() => process.exit(0), 450)
