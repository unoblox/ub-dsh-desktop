import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- plain-JS electron-builder hook without type declarations
import { sign } from '../scripts/esigner-windows-hook.mjs'

// The stand-in "java" is a shell script, so this runs where /bin/sh does.
describe.runIf(process.platform !== 'win32')('eSigner sign hook', () => {
// A stand-in "java" that answers like CodeSignTool, chosen by FAKE_RESULT.
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'esigner-'))
  mkdirSync(join(dir, 'tool', 'jar'), { recursive: true })
  writeFileSync(join(dir, 'tool', 'jar', 'code_sign_tool-1.3.0.jar'), '')
  mkdirSync(join(dir, 'jdk', 'bin'), { recursive: true })
  const java = join(dir, 'jdk', 'bin', 'java')
  writeFileSync(java, `#!/bin/sh
echo "$@" > ${JSON.stringify(join(dir, 'args'))}
case "$FAKE_RESULT" in
  ok) echo "Code signed successfully: x" ;;
  quiet-fail) echo "Error: invalid credentials for $ESIGNER_PASSWORD" ;;
  *) echo "Error: TOTP $ESIGNER_TOTP_SECRET rejected" >&2; exit 1 ;;
esac
`)
  chmodSync(java, 0o755)
  vi.stubEnv('CODESIGNTOOL_DIR', join(dir, 'tool'))
  vi.stubEnv('JAVA_HOME', join(dir, 'jdk'))
  vi.stubEnv('ESIGNER_USERNAME', 'user')
  vi.stubEnv('ESIGNER_PASSWORD', 'pa ss"word')
  vi.stubEnv('ESIGNER_CREDENTIAL_ID', 'cred')
  vi.stubEnv('ESIGNER_TOTP_SECRET', 'TOTPSECRET')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

it('signs a file through CodeSignTool, passing credentials as plain arguments', async () => {
  vi.stubEnv('FAKE_RESULT', 'ok')
  await expect(sign({ path: 'C:/build/unoblox works.exe' })).resolves.toBeUndefined()
})

it('fails when CodeSignTool does not report success, even with exit code 0', async () => {
  vi.stubEnv('FAKE_RESULT', 'quiet-fail')
  const failure = sign({ path: 'setup.exe' })
  await expect(failure).rejects.toThrow('eSigner could not sign setup.exe')
  await expect(failure).rejects.not.toThrow('pa ss"word')
})

it('keeps the TOTP secret out of the error it raises', async () => {
  vi.stubEnv('FAKE_RESULT', 'fail')
  const error = await sign({ path: 'setup.exe' }).catch((caught: Error) => caught)
  expect(String(error)).toContain('[redacted]')
  expect(String(error)).not.toContain('TOTPSECRET')
})

it('refuses to run without the installed tool', async () => {
  vi.stubEnv('CODESIGNTOOL_DIR', '')
  await expect(sign({ path: 'setup.exe' })).rejects.toThrow('CODESIGNTOOL_DIR is not set')
})
})
