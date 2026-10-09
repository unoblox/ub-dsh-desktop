// electron-builder sign hook: SSL.com eSigner cloud signing through
// CodeSignTool (installed by the CI step "Install SSL.com CodeSignTool").
// electron-builder calls it for each executable it signs, the uninstaller and
// the setup .exe included. The credentials come only from the environment and
// are passed as arguments to java directly (no shell), so their characters
// need no quoting and they are never printed.
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function codeSignToolJar(directory) {
  const jars = readdirSync(join(directory, 'jar')).filter((name) => /^code_sign_tool-.*\.jar$/u.test(name))
  if (jars.length !== 1) throw new Error(`expected one CodeSignTool jar in ${directory}/jar, found ${jars.length}`)
  return join(directory, 'jar', jars[0])
}

export async function sign({ path }) {
  const directory = process.env.CODESIGNTOOL_DIR
  if (!directory) throw new Error('CODESIGNTOOL_DIR is not set; install CodeSignTool before packaging')
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
  let output = ''
  try {
    // CodeSignTool reads its conf/ folder relative to the working directory.
    const result = await run(java, [
      '-jar', codeSignToolJar(directory), 'sign',
      `-username=${process.env.ESIGNER_USERNAME}`,
      `-password=${process.env.ESIGNER_PASSWORD}`,
      `-credential_id=${process.env.ESIGNER_CREDENTIAL_ID}`,
      `-totp_secret=${process.env.ESIGNER_TOTP_SECRET}`,
      `-input_file_path=${path}`,
      '-override=true'
    ], { cwd: directory, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    output = `${result.stdout}${result.stderr}`
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}` || String(error)
  }
  // CodeSignTool can exit 0 after a failure, so success is its own message.
  if (!/Code signed successfully/iu.test(output)) {
    const redacted = output
      .split(process.env.ESIGNER_PASSWORD || '\0').join('[redacted]')
      .split(process.env.ESIGNER_TOTP_SECRET || '\0').join('[redacted]')
    throw new Error(`eSigner could not sign ${path}: ${redacted.trim().slice(-2000)}`)
  }
  console.log(`eSigner signed ${path}`)
}
