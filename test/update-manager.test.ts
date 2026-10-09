import { generateKeyPairSync } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain-JS CI script without type declarations
import { makeUpdateManifest } from '../scripts/make-update-manifest.mjs'

// The manager end to end on Linux: a local "release" signed with a test key,
// an AppImage install, check → automatic download → restart into the update.
const electron = vi.hoisted(() => ({
  userData: '',
  relaunch: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
  sent: [] as Array<{ phase: string; availableVersion?: string }>
}))
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.1',
    getName: () => 'unoblox works',
    isPackaged: true,
    isReady: () => true,
    getPath: () => electron.userData,
    relaunch: electron.relaunch,
    exit: electron.exit,
    quit: electron.quit
  },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_: string, status: { phase: string; availableVersion?: string }) => electron.sent.push(status) } }] },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
  net: { fetch: (url: string, init: RequestInit) => fetch(url, init) }
}))

const keys = generateKeyPairSync('ed25519')
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
let server: Server
let base = ''
let requests: string[] = []
let manifestText = ''
const release = mkdtempSync(join(tmpdir(), 'ota-release-'))
const NEW_APPIMAGE = 'new appimage bytes'

beforeAll(async () => {
  writeFileSync(join(release, 'unoblox-works-beta-0.1.2-beta.3-linux-x86_64.AppImage'), NEW_APPIMAGE)
  server = createServer((request, response) => {
    requests.push(request.url ?? '')
    if (request.url === '/latest.json') { response.end(manifestText); return }
    response.end(readFileSync(join(release, decodeURIComponent((request.url ?? '').slice(1)))))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
  manifestText = await makeUpdateManifest({ version: '0.1.2-beta.3', dir: release, baseUrl: base, privateKeyPem }) as string
})
afterAll(() => {
  server.close()
  rmSync(release, { recursive: true, force: true })
})

let home = ''
let manager: typeof import('../src/main/update/update-manager')
const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const realArch = Object.getOwnPropertyDescriptor(process, 'arch')
beforeEach(async () => {
  // These cases exercise the Linux AppImage path on every CI runner.
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })
  home = mkdtempSync(join(tmpdir(), 'ota-home-'))
  electron.userData = join(home, 'userData')
  electron.sent = []
  requests = []
  vi.clearAllMocks()
  writeFileSync(join(home, 'unoblox-works.AppImage'), 'old appimage bytes')
  vi.stubEnv('APPIMAGE', join(home, 'unoblox-works.AppImage'))
  vi.stubEnv('UNOBLOX_WORKS_UPDATE_FEED', `${base}/latest.json`)
  vi.stubEnv('UNOBLOX_WORKS_UPDATE_HOSTS', '127.0.0.1')
  vi.stubEnv('UNOBLOX_WORKS_UPDATE_PUBLIC_KEY', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  vi.resetModules()
  manager = await import('../src/main/update/update-manager')
})
afterEach(() => {
  if (realPlatform) Object.defineProperty(process, 'platform', realPlatform)
  if (realArch) Object.defineProperty(process, 'arch', realArch)
  manager.stopUpdateManager()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

it('downloads a newer signed build on its own, then installs it on restart', async () => {
  const status = await manager.checkForUpdates(true)
  expect(status).toMatchObject({ phase: 'downloaded', availableVersion: '0.1.2-beta.3' })
  // The banner went straight from checking to downloading: no download prompt.
  expect(electron.sent.map((sent) => sent.phase)).toEqual(expect.arrayContaining(['checking', 'available', 'downloading', 'downloaded']))
  expect(readFileSync(join(home, 'unoblox-works.AppImage'), 'utf8')).toBe('old appimage bytes')

  let prepared = false
  manager.startUpdateManager({ prepareToInstall: async () => { prepared = true } })
  await manager.installDownloadedUpdate()
  expect(prepared).toBe(true)
  expect(readFileSync(join(home, 'unoblox-works.AppImage'), 'utf8')).toBe(NEW_APPIMAGE)
  expect(electron.relaunch).toHaveBeenCalledWith(expect.objectContaining({ execPath: join(home, 'unoblox-works.AppImage') }))
  expect(electron.exit).toHaveBeenCalledWith(0)
})

it('does not download again once an update is ready', async () => {
  expect((await manager.checkForUpdates(true)).phase).toBe('downloaded')
  requests = []
  expect((await manager.checkForUpdates(true)).phase).toBe('downloaded')
  expect(requests).toEqual([])
})

it('reports up to date when the published build is not newer', async () => {
  const saved = manifestText
  const same = mkdtempSync(join(tmpdir(), 'ota-same-'))
  writeFileSync(join(same, 'unoblox-works-beta-0.1.1-linux-x86_64.AppImage'), 'same')
  manifestText = await makeUpdateManifest({ version: '0.1.1', dir: same, baseUrl: base, privateKeyPem }) as string
  try {
    expect((await manager.checkForUpdates(true)).phase).toBe('up-to-date')
    expect(requests).toEqual(['/latest.json'])
  } finally {
    manifestText = saved
    rmSync(same, { recursive: true, force: true })
  }
})

it('ignores a manifest signed with another key', async () => {
  vi.stubEnv('UNOBLOX_WORKS_UPDATE_PUBLIC_KEY', generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString())
  const status = await manager.checkForUpdates(true)
  expect(status).toMatchObject({ phase: 'error', message: 'update manifest signature is not valid' })
  expect(requests).toEqual(['/latest.json'])
  await manager.installDownloadedUpdate()
  expect(readFileSync(join(home, 'unoblox-works.AppImage'), 'utf8')).toBe('old appimage bytes')
})

it('stays quiet when a scheduled check fails', async () => {
  vi.stubEnv('UNOBLOX_WORKS_UPDATE_FEED', 'http://127.0.0.1:1/latest.json')
  const status = await manager.checkForUpdates(false)
  expect(status.phase).toBe('idle')
})

it('makes no request at all while automatic checks are off', async () => {
  vi.useFakeTimers()
  expect(manager.setAutomaticUpdateChecks(false)).toBe(true)
  manager.startUpdateManager({ prepareToInstall: async () => {} })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(requests).toEqual([])
  expect(manager.automaticUpdateChecks()).toBe(false)
})

it('checks on its own a short while after start when automatic checks are on', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
  manager.startUpdateManager({ prepareToInstall: async () => {} })
  await vi.advanceTimersByTimeAsync(31_000)
  vi.useRealTimers()
  await vi.waitFor(() => expect(requests[0]).toBe('/latest.json'), { timeout: 5_000 })
})

it('does not offer a version the user skipped, until they check by hand', async () => {
  manager.skipUpdate('0.1.2-beta.3')
  expect((await manager.checkForUpdates(false)).phase).toBe('idle')
  expect(requests).toEqual(['/latest.json'])
  expect((await manager.checkForUpdates(true)).phase).toBe('downloaded')
})

it('cannot update a Linux build run from an unpacked folder', async () => {
  vi.stubEnv('APPIMAGE', '')
  const status = await manager.checkForUpdates(true)
  expect(status.phase).toBe('unsupported')
  expect(status.message).toContain('.deb or AppImage')
  expect(requests).toEqual([])
})
