#!/usr/bin/env node
/**
 * Regenerate the app icons from build/brand/unoblox-mark.svg, the single
 * source for the unoblox mark (taken from the unoblox.ai favicon).
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Writes build/icon.png and build/app-icon.png (1024 px), build/icon.icns
 * (PNG entries, 16–1024 px), build/icon.ico (PNG entries, 16–256 px), the
 * light/dark logos (build/logo-{light,dark}.png, 336x192, the "u." glyph on
 * transparency) and the splash loaders (build/dsh-loader{,-dark}.gif: the
 * glyph with a gently pulsing gold dot, on each splash theme's background)
 * and the macOS disk image background (build/dmg-background{,@2x}.png: drag
 * to Applications, plus how to open an app macOS cannot verify).
 * The outputs are committed because electron-builder and the window code read
 * them directly; edit the SVG, rerun this, and commit both.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'build', 'brand', 'unoblox-mark.svg')

async function png(svg, size) {
  return sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 1024)) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** ICNS with PNG payloads (supported for every type below since macOS 10.7). */
function icns(entries) {
  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([header, data])
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

/** ICO with PNG payloads (Windows Vista and later). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const directory = images.map(([size, data]) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })
  return Buffer.concat([header, ...directory, ...images.map(([, data]) => data)])
}

const svg = await readFile(source)
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const rendered = Object.fromEntries(await Promise.all(sizes.map(async (size) => [size, await png(svg, size)])))

await writeFile(join(root, 'build', 'icon.png'), rendered[1024])
await writeFile(join(root, 'build', 'app-icon.png'), rendered[1024])
await writeFile(join(root, 'build', 'icon.icns'), icns([
  ['icp4', rendered[16]], ['icp5', rendered[32]], ['icp6', rendered[64]],
  ['ic07', rendered[128]], ['ic08', rendered[256]], ['ic09', rendered[512]], ['ic10', rendered[1024]],
  ['ic11', rendered[32]], ['ic12', rendered[64]], ['ic13', rendered[256]], ['ic14', rendered[512]]
]))
await writeFile(join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => [size, rendered[size]])))
// The bare glyph (no tile) in the mark's 1024 coordinate space.
const U_PATH = 'M288 360V563A124.5 124.5 0 0 0 537 563V360M537 360V736'
const GOLD = '#D9A64A'
function glyph({ width, height, scale, ink, background, dotScale = 1 }) {
  // Glyph bounds in mark units: x 240..810, y 360..762; centre it.
  const x = width / 2 - ((240 + 810) / 2) * scale
  const y = height / 2 - ((360 + 762) / 2) * scale
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${
    background === undefined ? '' : `<rect width="${width}" height="${height}" fill="${background}"/>`
  }<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})"><path d="${U_PATH}" fill="none" stroke="${ink}" stroke-width="96"/><circle cx="720" cy="672" r="${(90 * dotScale).toFixed(2)}" fill="${GOLD}"/></g></svg>`)
}

for (const [file, ink] of [['logo-light.png', '#0C0C0C'], ['logo-dark.png', '#F1E9DC']]) {
  await writeFile(join(root, 'build', file), await sharp(glyph({ width: 336, height: 192, scale: 0.22, ink })).png({ compressionLevel: 9 }).toBuffer())
}

// Splash loaders: same file names and canvas as before, so splash.html is
// unchanged apart from dropping its pixel-art scaling.
const LOADER = { width: 640, height: 360, frames: 36, delay: 60 }
for (const [file, ink, background] of [['dsh-loader.gif', '#0C0C0C', '#f8f8f6'], ['dsh-loader-dark.gif', '#F1E9DC', '#141416']]) {
  const frames = await Promise.all(Array.from({ length: LOADER.frames }, (_, index) => {
    // Breathe between 82% and 100% so the dot never touches the "u".
    const dotScale = 0.91 + 0.09 * Math.sin((2 * Math.PI * index) / LOADER.frames)
    return sharp(glyph({ width: LOADER.width, height: LOADER.height, scale: 0.42, ink, background, dotScale })).ensureAlpha().raw().toBuffer()
  }))
  await writeFile(join(root, 'build', file), await sharp(Buffer.concat(frames), {
    raw: { width: LOADER.width, height: LOADER.height * LOADER.frames, channels: 4, pageHeight: LOADER.height }
  }).gif({ delay: Array.from({ length: LOADER.frames }, () => LOADER.delay), loop: 0, effort: 10 }).toBuffer())
}

// Disk image window: the app icon and the Applications link sit on the two
// circles (build/brand/dmg-layout.json, also read by electron-builder.beta.cjs). Beta builds
// are ad-hoc signed, not notarized, so macOS blocks the first open; the panel
// says how to allow it once. Text is rendered with Inter (installed where this
// script runs), so the committed PNGs do not depend on the build machine.
const DMG_WINDOW = JSON.parse(await readFile(join(root, 'build', 'brand', 'dmg-layout.json'), 'utf8'))
function dmgBackground(scale) {
  const { width, height, app, applications } = DMG_WINDOW
  const steps = [
    'Double-click unoblox works in Applications. If macOS says it cannot verify the app, click Done.',
    'Open System Settings \u203a Privacy &amp; Security, scroll down and click Open Anyway.'
  ]
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#F8F8F6"/>
  <text x="${width / 2}" y="54" text-anchor="middle" font-family="Inter" font-size="19" font-weight="600" fill="#0C0C0C">Drag unoblox works to Applications</text>
  <circle cx="${app.x}" cy="${app.y}" r="66" fill="#FFFFFF" stroke="#E6E2DA"/>
  <circle cx="${applications.x}" cy="${applications.y}" r="66" fill="#FFFFFF" stroke="#E6E2DA"/>
  <path d="M${app.x + 92} ${app.y}H${applications.x - 100}" stroke="#D9A64A" stroke-width="4" stroke-linecap="round"/>
  <path d="M${applications.x - 114} ${app.y - 13}L${applications.x - 98} ${app.y}L${applications.x - 114} ${app.y + 13}" fill="none" stroke="#D9A64A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="40" y="290" width="${width - 80}" height="118" rx="14" fill="#FFFFFF" stroke="#E6E2DA"/>
  <text x="62" y="320" font-family="Inter" font-size="13" font-weight="600" fill="#0C0C0C">First open (once): unoblox works beta is not notarized by Apple yet</text>
  ${steps.map((step, index) => `<circle cx="70" cy="${348 + index * 30}" r="10" fill="#D9A64A"/><text x="70" y="${352.5 + index * 30}" text-anchor="middle" font-family="Inter" font-size="12" font-weight="700" fill="#FFFFFF">${index + 1}</text><text x="88" y="${352.5 + index * 30}" font-family="Inter" font-size="12.5" fill="#3A3A38">${step}</text>`).join('')}
</svg>`)
}
await writeFile(join(root, 'build', 'dmg-background.png'), await sharp(dmgBackground(1)).png({ compressionLevel: 9 }).toBuffer())
await writeFile(join(root, 'build', 'dmg-background@2x.png'), await sharp(dmgBackground(2)).png({ compressionLevel: 9 }).toBuffer())

console.log('brand assets written: icon.png, app-icon.png, icon.icns, icon.ico, logo-light.png, logo-dark.png, dsh-loader.gif, dsh-loader-dark.gif, dmg-background.png, dmg-background@2x.png')
