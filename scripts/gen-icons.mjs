// Genera los íconos de la PWA sin dependencias (PNG con zlib). Uso: npm run icons
// Diseño simple: fondo verde, anillo blanco y una franja (escudo genérico). Reemplazar por el escudo del club.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(import.meta.dirname, '..', 'public-ventas', 'icons')
const OUT_ADMIN = join(import.meta.dirname, '..', 'public-admin', 'icons')
const GREEN = [20, 83, 45]
const WHITE = [255, 255, 255]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size)
      const i = y * (size * 3 + 1) + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** scale < 1 deja margen (íconos maskable). */
const badge = (scale) => (u, v) => {
  const dx = (u - 0.5) / scale
  const dy = (v - 0.5) / scale
  const d = Math.hypot(dx, dy)
  if (d > 0.36 && d < 0.44) return WHITE // anillo
  if (d <= 0.36 && Math.abs(dy) < 0.07) return WHITE // franja
  return GREEN
}

mkdirSync(OUT, { recursive: true })
mkdirSync(OUT_ADMIN, { recursive: true })
const files = {
  'icon-192.png': png(192, badge(1)),
  'icon-512.png': png(512, badge(1)),
  'icon-512-maskable.png': png(512, badge(0.78)),
  'apple-touch-icon.png': png(180, badge(0.9)),
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#14532d"/><circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="8"/><rect x="14" y="43" width="72" height="14" fill="#fff"/></svg>\n`
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(OUT, name), data)
  writeFileSync(join(OUT_ADMIN, name), data)
}
writeFileSync(join(OUT, 'icon.svg'), svg)
writeFileSync(join(OUT_ADMIN, 'icon.svg'), svg)
console.log('Íconos generados en public-ventas/icons y public-admin/icons')
