import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InternetTunnelInstance } from '../src/main/mobile/internet-tunnel'
import {
  isInternetTunnelHost,
  isPrivateAddress,
  LanMobileBridge
} from '../src/main/mobile/lan-mobile-bridge'

// The phone apps (mobile/android, mobile/ios) open only the links described in
// mobile/shared/pairing-links.json, and their unit tests check their parsers
// against the same file. This test holds the desktop side to it: every link
// the bridge puts in a Connect Phone QR code must be one the apps accept.

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  // A fixed Wi-Fi address, so the LAN link exists on any test machine.
  return {
    ...actual,
    networkInterfaces: () => ({
      en0: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: '192.168.1.20/24' }]
    })
  }
})

interface Fixtures {
  tokenPattern: string
  tunnelHostSuffixes: string[]
  excludedTunnelHosts: string[]
  accept: { link: string; origin: string; token: string; mode: 'lan' | 'tunnel' }[]
  reject: { link: string; why: string }[]
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'mobile', 'shared', 'pairing-links.json'), 'utf8')
) as Fixtures

const bridges: LanMobileBridge[] = []
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
})

/** The apps' rules (Links.kt / Links.swift), written from the shared file. */
function appAccepts(link: string): boolean {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return false
  }
  if (url.username || url.password || url.pathname !== '/pair') return false
  const tokens = url.search.slice(1).split('&').filter((part) => part.startsWith('token='))
  if (tokens.length !== 1 || !new RegExp(fixtures.tokenPattern).test(tokens[0]!.slice('token='.length))) return false
  const host = url.hostname.toLowerCase()
  if (url.protocol === 'http:') {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isPrivateAddress(host) && !host.startsWith('127.')
  }
  if (url.protocol === 'https:') {
    return !fixtures.excludedTunnelHosts.includes(host) &&
      fixtures.tunnelHostSuffixes.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  }
  return false
}

function fakeTunnel(provider: InternetTunnelInstance['provider'], url: string): InternetTunnelInstance {
  return { provider, url, process: {} as InternetTunnelInstance['process'], stop: async () => {} }
}

describe('phone app pairing contract', () => {
  it('describes the apps’ rules faithfully', () => {
    for (const item of fixtures.accept) expect(appAccepts(item.link), item.link).toBe(true)
    for (const item of fixtures.reject) expect(appAccepts(item.link), `${item.link} (${item.why})`).toBe(false)
  })

  it('lists the same tunnel hosts as the bridge', () => {
    for (const suffix of fixtures.tunnelHostSuffixes) {
      expect(isInternetTunnelHost(`abc${suffix}`), suffix).toBe(true)
    }
    for (const host of fixtures.excludedTunnelHosts) expect(isInternetTunnelHost(host), host).toBe(false)
    for (const item of fixtures.accept.filter((entry) => entry.mode === 'tunnel')) {
      expect(isInternetTunnelHost(new URL(item.origin).hostname), item.origin).toBe(true)
    }
  })

  it('puts a link the apps accept in the Wi-Fi QR code', async () => {
    const bridge = new LanMobileBridge({ harnessUrl: () => undefined, port: 0 })
    bridges.push(bridge)
    const snapshot = await bridge.start()
    expect(snapshot.pairingUrl).toMatch(/^http:\/\/192\.168\.1\.20:\d+\/pair\?token=/)
    expect(appAccepts(snapshot.pairingUrl!)).toBe(true)
  })

  it.each([
    ['cloudflare', 'https://quiet-river-1234.trycloudflare.com'],
    ['pinggy', 'https://rnxyz-1-2-3-4.a.free.pinggy.link']
  ] as const)('puts a link the apps accept in the %s QR code', async (provider, tunnelUrl) => {
    const bridge = new LanMobileBridge({
      harnessUrl: () => undefined,
      port: 0,
      forceCloudflareFailure: provider === 'pinggy',
      createCloudflareTunnel: async () => fakeTunnel('cloudflare', tunnelUrl),
      createPinggyTunnel: async () => fakeTunnel('pinggy', tunnelUrl)
    })
    bridges.push(bridge)
    await bridge.start()
    await bridge.toggleTunnel(true)
    const { pairingUrl } = bridge.snapshot()
    expect(pairingUrl?.startsWith(`${tunnelUrl}/pair?token=`)).toBe(true)
    expect(appAccepts(pairingUrl!)).toBe(true)
  })
})
