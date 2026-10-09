/**
 * Build and sign the over-the-air update manifest (`latest.json`) for one
 * beta release. Read by src/main/update/ota-manifest.ts.
 *
 *   UPDATE_SIGNING_KEY="$(cat private.pem)" node scripts/make-update-manifest.mjs \
 *     --version 0.1.2-beta.30 --dir release-assets \
 *     --base-url https://github.com/unoblox/unoblox-works-releases/releases/download/v0.1.2-beta.30 \
 *     --out release-assets/latest.json
 *
 * Files in --dir are matched to platforms by name: the macOS update zip, the
 * Windows setup .exe, the Linux AppImage and .deb. The private key comes only
 * from the UPDATE_SIGNING_KEY environment variable and is never printed.
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export const PLATFORM_PATTERNS = {
  'darwin-arm64': /-mac-arm64\.zip$/u,
  'win32-x64': /-windows-x64-setup\.exe$/u,
  'linux-x64-appimage': /-linux-x86_64\.AppImage$/u,
  'linux-x64-deb': /-linux-amd64\.deb$/u
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * @param {{ version: string, dir: string, baseUrl: string, privateKeyPem: string, notes?: string, publishedAt?: string }} options
 * @returns {Promise<string>} the signed envelope as JSON text
 */
export async function makeUpdateManifest(options) {
  const names = await readdir(options.dir)
  const files = {}
  for (const [key, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const matches = names.filter((name) => pattern.test(name))
    if (matches.length > 1) throw new Error(`more than one ${key} file: ${matches.join(', ')}`)
    const name = matches[0]
    if (name === undefined) continue
    const path = join(options.dir, name)
    files[key] = {
      name,
      url: `${options.baseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(name)}`,
      sha256: await sha256(path),
      size: (await stat(path)).size
    }
  }
  if (Object.keys(files).length === 0) throw new Error(`no update files in ${options.dir}`)
  const payload = JSON.stringify({
    product: 'unoblox works',
    channel: 'beta',
    version: options.version,
    publishedAt: options.publishedAt ?? new Date().toISOString(),
    ...(options.notes ? { notes: options.notes } : {}),
    files
  })
  const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(options.privateKeyPem)).toString('base64')
  return `${JSON.stringify({ format: 1, payload, signature }, null, 2)}\n`
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      dir: { type: 'string' },
      'base-url': { type: 'string' },
      out: { type: 'string' },
      notes: { type: 'string' }
    }
  })
  const privateKeyPem = process.env.UPDATE_SIGNING_KEY
  if (!values.version || !values.dir || !values['base-url'] || !values.out) {
    console.error('usage: make-update-manifest --version V --dir DIR --base-url URL --out FILE [--notes TEXT]')
    process.exit(2)
  }
  if (!privateKeyPem) {
    console.error('make-update-manifest: UPDATE_SIGNING_KEY is not set')
    process.exit(2)
  }
  const text = await makeUpdateManifest({ version: values.version, dir: values.dir, baseUrl: values['base-url'], privateKeyPem, notes: values.notes })
  await writeFile(values.out, text)
  console.log(`make-update-manifest: wrote ${values.out} for ${values.version}: ${Object.keys(JSON.parse(JSON.parse(text).payload).files).join(', ')}`)
}
