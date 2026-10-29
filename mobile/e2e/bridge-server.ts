/**
 * Runs the desktop's real phone bridge on its own, for the phone app tests in
 * .github/workflows/build-mobile.yml. There is no Harness behind it: a phone
 * can pair and load the page, but has no conversations.
 *
 *   npx esbuild mobile/e2e/bridge-server.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=<dir>/bridge-server.mjs && node <dir>/bridge-server.mjs
 *
 * Prints one JSON line, {"port","token","pairingUrl"}, then serves until stopped.
 * The token pairs one phone, once, within five minutes, like the desktop's.
 *
 * BRIDGE_ADDRESS sets the address the pairing link names, for a phone that
 * reaches this machine at an address it does not have itself (the Android
 * emulator sees its host as 10.0.2.2).
 */
import { createRequire, syncBuiltinESMExports } from 'node:module'
import type { NetworkInterfaceInfo } from 'node:os'

const address = process.env.BRIDGE_ADDRESS
if (address) {
  const os = createRequire(import.meta.url)('node:os') as typeof import('node:os')
  const entry: NetworkInterfaceInfo = {
    address, netmask: '255.255.255.255', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/32`
  }
  os.networkInterfaces = () => ({ e2e: [entry] })
  syncBuiltinESMExports()
}
const { LanMobileBridge } = await import('../../src/main/mobile/lan-mobile-bridge')

const bridge = new LanMobileBridge({
  harnessUrl: () => undefined,
  locale: 'en',
  port: Number(process.env.BRIDGE_PORT ?? 0)
})
const snapshot = await bridge.start()
if (!snapshot.pairingUrl || !snapshot.port) {
  console.error('The bridge has no private IPv4 address to offer a phone.')
  process.exit(1)
}
const token = new URL(snapshot.pairingUrl).searchParams.get('token')
console.log(JSON.stringify({ port: snapshot.port, token, pairingUrl: snapshot.pairingUrl }))

const stop = (): void => {
  void bridge.stop().finally(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
