import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadUpdateFile, fetchManifestText } from '../src/main/update/ota-download'
import { linuxInstallKind, macBundleIsUpdatable, macBundlePath, macSwapScript, replaceAppImage, shellQuote } from '../src/main/update/ota-install'
import { isAllowedUpdateUrl, offeredUpdate, parseSignedManifest, updatePlatformKey } from '../src/main/update/ota-manifest'
import { readAutomaticChecks, UPDATE_FEED_URL, UPDATE_PUBLIC_KEY, updateFeed, writeAutomaticChecks } from '../src/main/update/update-policy'
// @ts-expect-error -- plain-JS CI script without type declarations
import { makeUpdateManifest } from '../scripts/make-update-manifest.mjs'

const keys = generateKeyPairSync('ed25519')
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const LOCAL = ['127.0.0.1']

const temps: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ota-test-'))
  temps.push(dir)
  return dir
}
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }) })

// Release assets as CI names them, with stand-in contents.
function releaseDir(): string {
  const dir = temp()
  writeFileSync(join(dir, 'unoblox-works-beta-0.1.2-beta.7-mac-arm64.zip'), 'mac update')
  writeFileSync(join(dir, 'unoblox-works-beta-0.1.2-beta.7-windows-x64-setup.exe'), 'windows setup')
  writeFileSync(join(dir, 'unoblox-works-beta-0.1.2-beta.7-linux-x86_64.AppImage'), 'appimage bytes')
  writeFileSync(join(dir, 'unoblox-works-beta-0.1.2-beta.7-linux-amd64.deb'), 'deb bytes')
  writeFileSync(join(dir, 'unoblox-works-beta-0.1.2-beta.7-mac-arm64.dmg'), 'not an update file')
  return dir
}

async function manifestFor(dir: string, baseUrl = 'https://github.com/unoblox/unoblox-works-releases/releases/download/v0.1.2-beta.7'): Promise<string> {
  return makeUpdateManifest({ version: '0.1.2-beta.7', dir, baseUrl, privateKeyPem, notes: 'Faster startup.' }) as Promise<string>
}

describe('signed update manifest', () => {
  it('is built by the CI script and accepted with the matching key', async () => {
    const manifest = parseSignedManifest(await manifestFor(releaseDir()), publicKeyPem)
    expect(manifest.version).toBe('0.1.2-beta.7')
    expect(manifest.notes).toBe('Faster startup.')
    expect(Object.keys(manifest.files).sort()).toEqual(['darwin-arm64', 'linux-x64-appimage', 'linux-x64-deb', 'win32-x64'])
    expect(manifest.files['win32-x64']).toMatchObject({
      name: 'unoblox-works-beta-0.1.2-beta.7-windows-x64-setup.exe',
      size: 'windows setup'.length,
      sha256: createHash('sha256').update('windows setup').digest('hex')
    })
  })

  it('rejects another key, an edited payload and an edited signature', async () => {
    const text = await manifestFor(releaseDir())
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(() => parseSignedManifest(text, other)).toThrow('signature is not valid')
    const envelope = JSON.parse(text) as { payload: string; signature: string }
    const edited = { ...envelope, payload: envelope.payload.replace('0.1.2-beta.7', '9.9.9') }
    expect(() => parseSignedManifest(JSON.stringify({ format: 1, ...edited }), publicKeyPem)).toThrow('signature is not valid')
    const flipped = { ...envelope, signature: Buffer.from('x'.repeat(64)).toString('base64') }
    expect(() => parseSignedManifest(JSON.stringify({ format: 1, ...flipped }), publicKeyPem)).toThrow('signature is not valid')
    expect(() => parseSignedManifest('not json', publicKeyPem)).toThrow('not JSON')
    expect(() => parseSignedManifest('{"format":2}', publicKeyPem)).toThrow('format')
  })

  it('rejects a signed manifest that points downloads at another host or over http', async () => {
    await expect(manifestFor(releaseDir(), 'https://example.com/x').then((text) => parseSignedManifest(text, publicKeyPem))).rejects.toThrow('not valid')
    expect(isAllowedUpdateUrl('http://github.com/x')).toBe(false)
    expect(isAllowedUpdateUrl('https://user:pw@github.com/x')).toBe(false)
    expect(isAllowedUpdateUrl('https://release-assets.githubusercontent.com/x')).toBe(true)
    expect(isAllowedUpdateUrl('http://127.0.0.1:9/x')).toBe(false)
    expect(isAllowedUpdateUrl('http://127.0.0.1:9/x', LOCAL)).toBe(true)
  })

  it('offers only a newer version, for this platform', async () => {
    const manifest = parseSignedManifest(await manifestFor(releaseDir()), publicKeyPem)
    expect(offeredUpdate(manifest, '0.1.1', 'darwin-arm64')?.version).toBe('0.1.2-beta.7')
    expect(offeredUpdate(manifest, '0.1.2-beta.6', 'win32-x64')?.file.name).toContain('setup.exe')
    expect(offeredUpdate(manifest, '0.1.2-beta.7', 'win32-x64')).toBeUndefined()
    expect(offeredUpdate(manifest, '0.1.2', 'win32-x64')).toBeUndefined()
    expect(offeredUpdate({ ...manifest, files: {} }, '0.1.1', 'win32-x64')).toBeUndefined()
  })

  it('maps each install to the file it updates from', () => {
    expect(updatePlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(updatePlatformKey('darwin', 'x64')).toBeUndefined()
    expect(updatePlatformKey('win32', 'x64')).toBe('win32-x64')
    expect(updatePlatformKey('linux', 'x64', 'appimage')).toBe('linux-x64-appimage')
    expect(updatePlatformKey('linux', 'x64', 'deb')).toBe('linux-x64-deb')
    expect(updatePlatformKey('linux', 'x64')).toBeUndefined()
    expect(linuxInstallKind({ APPIMAGE: '/home/a/unoblox-works.AppImage' }, '/tmp/.mount_x/unoblox-works')).toBe('appimage')
    expect(linuxInstallKind({}, '/opt/unoblox works/unoblox-works')).toBe('deb')
    expect(linuxInstallKind({}, '/home/a/linux-unpacked/unoblox-works')).toBeUndefined()
  })
})

describe('update feed settings', () => {
  it('reads the published feed with the shipped key unless a test feed is set', () => {
    expect(updateFeed({})).toMatchObject({ url: UPDATE_FEED_URL, publicKey: UPDATE_PUBLIC_KEY })
    expect(UPDATE_FEED_URL).toBe('https://github.com/unoblox/unoblox-works-releases/releases/latest/download/latest.json')
    expect(updateFeed({ UNOBLOX_WORKS_UPDATE_FEED: 'http://127.0.0.1:1/latest.json', UNOBLOX_WORKS_UPDATE_HOSTS: '127.0.0.1' }))
      .toMatchObject({ url: 'http://127.0.0.1:1/latest.json', allowedHosts: ['127.0.0.1'] })
  })

  it('keeps automatic checks on until the user turns them off', () => {
    const dir = temp()
    expect(readAutomaticChecks(dir)).toBe(true)
    expect(writeAutomaticChecks(dir, false)).toBe(true)
    expect(readAutomaticChecks(dir)).toBe(false)
    writeAutomaticChecks(dir, true)
    expect(readAutomaticChecks(dir)).toBe(true)
  })
})

describe('update download', () => {
  let server: Server
  let base = ''
  const body = Buffer.from('x'.repeat(200_000))
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/latest.json') { response.end('{"format":1}'); return }
      if (request.url === '/missing.json') { response.statusCode = 404; response.end(); return }
      if (request.url === '/elsewhere') { response.statusCode = 302; response.setHeader('location', 'http://localhost:1/x'); response.end(); return }
      response.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
  })
  afterAll(() => { server.close() })

  const file = () => ({ name: 'update.bin', url: `${base}/file`, sha256: createHash('sha256').update(body).digest('hex'), size: body.length })

  it('fetches the manifest text, and reads "no release yet" as nothing to do', async () => {
    expect(await fetchManifestText(fetch, `${base}/latest.json`, LOCAL)).toBe('{"format":1}')
    expect(await fetchManifestText(fetch, `${base}/missing.json`, LOCAL)).toBe('')
    await expect(fetchManifestText(fetch, `${base}/latest.json`)).rejects.toThrow('not allowed')
  })

  it('keeps a file only when its size and checksum match, and reuses it', async () => {
    const dir = temp()
    const progress: number[] = []
    const path = await downloadUpdateFile(fetch, file(), dir, (percent) => progress.push(percent), LOCAL)
    expect(readFileSync(path)).toEqual(body)
    expect(progress.at(-1)).toBe(100)
    expect(readdirSync(dir)).toEqual(['update.bin'])
    let fetched = false
    await downloadUpdateFile(async (url, init) => { fetched = true; return fetch(url, init) }, file(), dir, () => {}, LOCAL)
    expect(fetched).toBe(false)
  })

  it('discards a download whose checksum or size is wrong', async () => {
    const dir = temp()
    await expect(downloadUpdateFile(fetch, { ...file(), sha256: '0'.repeat(64) }, dir, () => {}, LOCAL)).rejects.toThrow('checksum')
    await expect(downloadUpdateFile(fetch, { ...file(), size: body.length - 1 }, dir, () => {}, LOCAL)).rejects.toThrow('larger')
    await expect(downloadUpdateFile(fetch, { ...file(), size: body.length + 1 }, dir, () => {}, LOCAL)).rejects.toThrow('incomplete')
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a redirect to a host that is not allowed', async () => {
    await expect(downloadUpdateFile(fetch, { ...file(), url: `${base}/elsewhere` }, temp(), () => {}, LOCAL)).rejects.toThrow()
  })
})

describe('installing an update', () => {
  it('finds the macOS bundle and refuses to update one run from a disk image', () => {
    expect(macBundlePath('/Applications/unoblox works.app/Contents/MacOS/unoblox works')).toBe('/Applications/unoblox works.app')
    expect(macBundlePath('/usr/bin/node')).toBeUndefined()
    expect(macBundleIsUpdatable('/Applications/unoblox works.app')).toBe(true)
    expect(macBundleIsUpdatable('/Volumes/unoblox works beta/unoblox works.app')).toBe(false)
    expect(macBundleIsUpdatable('/private/var/folders/x/AppTranslocation/y/d/unoblox works.app')).toBe(false)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('swaps the macOS bundle after the app exits, keeping names with spaces and quotes intact', () => {
    const dir = temp()
    const target = join(dir, "Apps it's", 'unoblox works.app')
    const staged = join(dir, 'staged', 'unoblox works.app')
    mkdirSync(join(target, 'Contents'), { recursive: true })
    writeFileSync(join(target, 'Contents', 'version'), 'old')
    mkdirSync(join(staged, 'Contents'), { recursive: true })
    writeFileSync(join(staged, 'Contents', 'version'), 'new')
    mkdirSync(join(dir, 'Apps it\'s'), { recursive: true })
    const opened = join(dir, 'opened')
    const tool = (name: string, body: string) => {
      const path = join(dir, name)
      writeFileSync(path, `#!/bin/sh\n${body}\n`)
      chmodSync(path, 0o755)
      return path
    }
    const script = macSwapScript({
      pid: 999_999,
      staged,
      target,
      log: join(dir, 'log'),
      tools: { ditto: tool('ditto', 'cp -R "$1" "$2"'), xattr: tool('xattr', 'exit 0'), open: tool('open', `echo "$1" > ${shellQuote(opened)}`) }
    })
    writeFileSync(join(dir, 'apply.sh'), script)
    execFileSync('/bin/sh', [join(dir, 'apply.sh')])
    expect(readFileSync(join(target, 'Contents', 'version'), 'utf8')).toBe('new')
    expect(existsSync(`${target}.previous`)).toBe(false)
    expect(existsSync(`${target}.updating`)).toBe(false)
    expect(readFileSync(opened, 'utf8').trim()).toBe(target)
    expect(readFileSync(join(dir, 'log'), 'utf8')).toContain('update installed')
  })

  it('leaves the installed bundle in place when the copy fails', () => {
    const dir = temp()
    const target = join(dir, 'unoblox works.app')
    mkdirSync(target)
    writeFileSync(join(target, 'v'), 'old')
    const fail = join(dir, 'fail')
    writeFileSync(fail, '#!/bin/sh\nexit 1\n')
    chmodSync(fail, 0o755)
    const ok = join(dir, 'ok')
    writeFileSync(ok, '#!/bin/sh\nexit 0\n')
    chmodSync(ok, 0o755)
    writeFileSync(join(dir, 'apply.sh'), macSwapScript({ pid: 999_999, staged: join(dir, 'nope.app'), target, log: join(dir, 'log'), tools: { ditto: fail, xattr: ok, open: ok } }))
    expect(() => execFileSync('/bin/sh', [join(dir, 'apply.sh')])).toThrow()
    expect(readFileSync(join(target, 'v'), 'utf8')).toBe('old')
  })

  it('replaces the AppImage file in place, executable', async () => {
    const dir = temp()
    const appImage = join(dir, 'unoblox-works.AppImage')
    writeFileSync(appImage, 'old')
    const downloaded = join(dir, 'download.AppImage')
    writeFileSync(downloaded, 'new')
    await replaceAppImage(appImage, downloaded)
    expect(readFileSync(appImage, 'utf8')).toBe('new')
    expect(execFileSync('stat', ['-c', '%a', appImage]).toString().trim()).toBe('755')
    expect(readdirSync(dir).sort()).toEqual(['download.AppImage', 'unoblox-works.AppImage'])
  })
})
