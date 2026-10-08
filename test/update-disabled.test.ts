import { expect, it, vi } from 'vitest'

// Without an Unoblox update feed, no update path may reach the network: the
// inherited endpoints belong to upstream and would receive the installation ID.
const mocks = vi.hoisted(() => ({ policy: vi.fn(), check: vi.fn(), download: vi.fn() }))
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true, getPath: () => '/tmp/unoblox-update-disabled' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { on: vi.fn() }
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: { on: vi.fn(), setFeedURL: vi.fn(), checkForUpdates: mocks.check, downloadUpdate: mocks.download } } }))
vi.mock('../src/main/desktop-service', () => ({ checkDesktopUpdate: mocks.policy }))
vi.mock('../src/main/update/update-policy', async importOriginal => ({ ...await importOriginal<object>(), supportsAutoUpdates: () => true }))

it('never checks, lists or installs updates while no Unoblox feed is configured', async () => {
  const manager = await import('../src/main/update/update-manager')
  manager.startUpdateManager({ prepareToInstall: async () => {} })
  const status = await manager.checkForUpdates(true)
  expect(status.phase).toBe('unsupported')
  expect(status.message).toContain('Install the latest Unoblox beta')
  await manager.installSpecificVersion('2.0.0')
  expect(mocks.policy).not.toHaveBeenCalled()
  expect(mocks.check).not.toHaveBeenCalled()
  expect(mocks.download).not.toHaveBeenCalled()
})
