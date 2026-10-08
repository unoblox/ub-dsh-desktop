import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MobileBridgeDemand,
  mobileBridgePreferencePath,
  readKeepPhoneConnected,
  writeKeepPhoneConnected
} from '../src/main/mobile/mobile-bridge-demand'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('phone bridge on demand', () => {
  it('does not listen at launch unless Keep Phone Connected is on', () => {
    expect(new MobileBridgeDemand(false).wanted()).toBe(false)
    expect(new MobileBridgeDemand(true).wanted()).toBe(true)
  })

  it('runs for pairing and closes with the window when no phone paired', () => {
    const demand = new MobileBridgeDemand(false)
    demand.pairingOpened()
    expect(demand.wanted()).toBe(true)
    expect(demand.pairingClosed(false)).toBe(true)
    expect(demand.wanted()).toBe(false)
  })

  it('keeps running for a paired phone, including across Harness restarts', () => {
    const demand = new MobileBridgeDemand(false)
    demand.pairingOpened()
    expect(demand.pairingClosed(true)).toBe(false)
    expect(demand.wanted()).toBe(true)
  })

  it('never stops for the pairing window while Keep Phone Connected is on', () => {
    const demand = new MobileBridgeDemand(true)
    demand.pairingOpened()
    expect(demand.pairingClosed(false)).toBe(false)
  })

  it('turning Keep Phone Connected off drops neither an attached phone nor an open pairing', () => {
    const attached = new MobileBridgeDemand(true)
    attached.pairingOpened()
    attached.pairingClosed(true)
    expect(attached.setKeepConnected(false, { pairingWindowOpen: false, phoneConnected: true })).toBe(true)

    const pairing = new MobileBridgeDemand(true)
    pairing.pairingOpened()
    expect(pairing.setKeepConnected(false, { pairingWindowOpen: true, phoneConnected: false })).toBe(true)

    const idle = new MobileBridgeDemand(true)
    expect(idle.setKeepConnected(false, { pairingWindowOpen: false, phoneConnected: false })).toBe(false)
    expect(idle.setKeepConnected(true, { pairingWindowOpen: false, phoneConnected: false })).toBe(true)
  })

  it('persists the preference, reading anything unexpected as off', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mobile-bridge-pref-'))
    homes.push(home)
    const path = mobileBridgePreferencePath(home)
    expect(readKeepPhoneConnected(path)).toBe(false)
    expect(writeKeepPhoneConnected(path, true)).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ keepConnected: true })
    expect(readKeepPhoneConnected(path)).toBe(true)
    await writeFile(path, '{"keepConnected":"yes"}')
    expect(readKeepPhoneConnected(path)).toBe(false)
    await writeFile(path, 'not json')
    expect(readKeepPhoneConnected(path)).toBe(false)
  })
})
