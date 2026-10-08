#!/usr/bin/env node
/**
 * Smoke test a packaged Linux build: launch the real app (Electron main,
 * Harness child through Electron Node mode, installed plugins and Office
 * payload) with a throwaway HOME, then check each startup stage through the
 * same authenticated HTTP surface the window uses.
 *
 * Usage (needs a display, e.g. under xvfb-run):
 *   node scripts/smoke-packaged-linux.mjs <unpacked-app-directory>
 *
 * Stages checked, in order: Harness ready (URL line in harness.log) → token
 * login → HTML with the client bootstrap → bootstrap registers the module
 * system → workspace and session creation → the Unoblox info route. A model
 * call is not made; that needs a key and belongs to a keyed live check.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const appDirectory = resolve(process.argv[2] ?? 'dist-dev/linux-unpacked')
const READY_TIMEOUT_MS = 120_000

function executableIn(directory) {
  // electron-builder names the binary after linux.executableName.
  for (const name of ['dsh-desktop', 'dsh-desktop-dev']) {
    if (existsSync(join(directory, name))) return join(directory, name)
  }
  throw new Error(`no app executable in ${directory}: ${readdirSync(directory).join(', ')}`)
}

function fail(message) {
  console.error(`smoke: FAIL ${message}`)
  process.exitCode = 1
}

const executable = executableIn(appDirectory)
const home = await mkdtemp(join(tmpdir(), 'dsh-linux-smoke-'))
const config = join(home, '.config')
await mkdir(config, { recursive: true })
const args = []
// Chromium refuses to run as root without this; CI runners are not root.
if (process.getuid?.() === 0) args.push('--no-sandbox')
const output = []
const child = spawn(executable, args, {
  cwd: home,
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (chunk) => output.push(String(chunk)))
child.stderr.on('data', (chunk) => output.push(String(chunk)))
let exited = false
child.on('exit', (code, signal) => {
  exited = true
  output.push(`[exit code=${String(code)} signal=${String(signal)}]`)
})

function findLog() {
  for (const name of ['dsh-desktop-dev', 'dsh-desktop', 'DSH Desktop Dev', 'DSH Desktop']) {
    const path = join(config, name, 'logs', 'harness.log')
    if (existsSync(path)) return path
  }
  return undefined
}

try {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let launch
  while (Date.now() < deadline && !exited) {
    const log = findLog()
    const match = log === undefined ? null : /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/u.exec(readFileSync(log, 'utf8'))
    if (match) {
      launch = new URL(match[1])
      break
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  if (launch === undefined) throw new Error(`Harness was not ready within ${READY_TIMEOUT_MS / 1000}s${exited ? ' (app exited)' : ''}`)
  console.log('smoke: harness ready')
  const origin = launch.origin

  const login = await fetch(launch, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  if (cookie === '') throw new Error(`token login set no cookie (HTTP ${login.status})`)
  console.log('smoke: token login ok')

  const html = await (await fetch(origin, { headers: { Cookie: cookie } })).text()
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map((match) => match[1].replaceAll('&amp;', '&'))
  const bootstrap = scripts.find((src) => src.includes('@deepseek-ai/dsh-client-modules/client.js'))
  if (bootstrap === undefined) throw new Error('HTML has no client bootstrap script')
  const bootstrapResponse = await fetch(new URL(bootstrap, origin), { headers: { Cookie: cookie } })
  const registrations = []
  runInNewContext(await bootstrapResponse.text(), { window: { __ModuleLoader__: { load: (registration) => registrations.push(registration.id) } } })
  if (!registrations.includes('@deepseek-ai/dsh-client-modules')) throw new Error('bootstrap did not register the module system')
  if (!html.includes('dsh-desktop-unoblox-info')) throw new Error('client graph lacks dsh-desktop-unoblox-info')
  console.log(`smoke: bootstrap registers ${registrations.length} modules`)

  let rpcId = 0
  const rpc = async (method, request) => {
    const response = await fetch(new URL(`/api/${method}`, origin), {
      method: 'POST',
      headers: { Cookie: cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `smoke-${++rpcId}`, method, payload: { args: { request } } })
    })
    const envelope = await response.json()
    if (envelope.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(envelope.result?.error ?? envelope)}`)
    return envelope.result.value
  }
  const workspacePath = join(home, 'workspace')
  await mkdir(workspacePath)
  const workspace = await rpc('workspace/create', { path: workspacePath })
  const session = await rpc('session/create', { workspaceId: workspace.workspace.workspaceId })
  if (typeof session.sessionId !== 'string') throw new Error('session/create returned no sessionId')
  console.log('smoke: workspace and session created')

  const info = await fetch(new URL(`/api/desktop-unoblox.info?session=${encodeURIComponent(session.sessionId)}`, origin), { headers: { Cookie: cookie } })
  const body = await info.json()
  if (info.status !== 200 || !['set', 'missing', 'unknown'].includes(body.key)) throw new Error(`unoblox info route: HTTP ${info.status} ${JSON.stringify(body)}`)
  console.log(`smoke: unoblox info route ok (key ${body.key})`)
  console.log('smoke: PASS')
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
  console.error(output.join('').split('\n').slice(-60).join('\n'))
  const log = findLog()
  if (log !== undefined) console.error(readFileSync(log, 'utf8').split('\n').slice(-80).join('\n'))
} finally {
  if (!exited) {
    child.kill('SIGTERM')
    await new Promise((done) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        done()
      }, 10_000)
      child.once('exit', () => {
        clearTimeout(timer)
        done()
      })
    })
  }
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
