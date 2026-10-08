import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reportsRegisteredConnection, startCloudflareQuickTunnel } from '../src/main/mobile/cloudflared-tunnel'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

/** A stand-in cloudflared that prints its banner, then registers after a delay. */
async function fakeCloudflared(registerAfterMs: number | undefined): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'fake-cloudflared-'))
  homes.push(home)
  const script = join(home, 'cloudflared')
  await writeFile(script, `#!${process.execPath}
const out = (line) => process.stderr.write(new Date().toISOString() + ' INF ' + line + '\\n')
out('|  https://quiet-river-sample.trycloudflare.com  |')
${registerAfterMs === undefined ? '' : `setTimeout(() => out('Registered tunnel connection connIndex=0 event=0 protocol=quic'), ${registerAfterMs})`}
setInterval(() => {}, 1000)
`)
  await chmod(script, 0o755)
  return script
}

describe.skipIf(process.platform === 'win32')('Cloudflare quick tunnel start', () => {
  it('reports the tunnel online only once its edge connection is registered', async () => {
    const started = Date.now()
    const tunnel = await startCloudflareQuickTunnel({ port: 9, binaryPath: await fakeCloudflared(600), timeoutMs: 10_000 })
    try {
      expect(tunnel.url).toBe('https://quiet-river-sample.trycloudflare.com')
      // The URL is printed at once; answering before registration is what
      // gave phones Cloudflare error 1033.
      expect(Date.now() - started).toBeGreaterThanOrEqual(500)
    } finally {
      await tunnel.stop()
    }
  })

  it('times out when the connection never registers', async () => {
    await expect(startCloudflareQuickTunnel({ port: 9, binaryPath: await fakeCloudflared(undefined), timeoutMs: 800 }))
      .rejects.toThrow('timed out')
  })
})

describe('registration log lines', () => {
  it('recognises current and older cloudflared wording', () => {
    expect(reportsRegisteredConnection('2026-10-08T06:29:50Z INF Registered tunnel connection connIndex=0 connection=8a5c event=0 ip=198.41.192.7 location=bom01 protocol=quic')).toBe(true)
    expect(reportsRegisteredConnection('INF Connection 3f6c1e2a-9b1d-4d38-a3b5-9f2f1c0d7e41 registered connIndex=0')).toBe(true)
    expect(reportsRegisteredConnection('INF Requesting new quick Tunnel on trycloudflare.com...')).toBe(false)
  })
})
