import { app } from 'electron'
import { join } from 'node:path'
import { DesktopService } from './service'
import { attachDiagnostics } from './diagnostics'

let service: DesktopService | undefined
export let desktopDiagnostics: ReturnType<typeof attachDiagnostics> | undefined

/** Call only after the single-instance lock, before bootstrap writes this session's log. */
export function initializeDesktopService(): void {
  if (!app.isPackaged || service) return
  try {
    service = new DesktopService({
      stateDir: join(app.getPath('userData'), 'desktop-service'),
      logPath: join(app.getPath('logs'), 'harness.log'),
      version: app.getVersion(), platform: process.platform, arch: process.arch,
      // Unoblox collects nothing from the user's machine. The inherited
      // service reported crashes and update checks, with an installation ID,
      // to upstream's dshdesktop.com; here it has no network at all. Crashes
      // are still captured locally for this app's own recovery prompts, and
      // reports are discarded without asking or sending.
      request: () => Promise.reject(new Error('Unoblox sends no crash reports or update checks')),
      confirmUpload: async () => false
    })
    desktopDiagnostics = attachDiagnostics(app, service, {
      onError: error => console.warn('[desktop-service]', error instanceof Error ? error.name : 'Diagnostic failure')
    })
  } catch (error) {
    service = undefined
    console.warn('[desktop-service] initialization failed', error instanceof Error ? error.name : 'Unknown error')
  }
}
export async function checkDesktopUpdate() {
  if (!service) throw new Error('Desktop update service is unavailable')
  return service.checkUpdate()
}
