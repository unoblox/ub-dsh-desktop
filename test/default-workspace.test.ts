import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENTS_DIRECTORY_ENV, documentsDirectory, documentsEnvironment } from '../src/main/runtime/documents-directory'

const projectRoot = path.resolve(import.meta.dirname, '..')
const read = (...parts: string[]) => readFile(path.join(projectRoot, ...parts), 'utf8')

describe('Documents folder for the first-use workspace', () => {
  // Built with this platform's path rules, so the cases hold on Windows too.
  const home = path.resolve('/home/asha')
  const documents = path.join(home, 'Documents')

  it('passes Electron’s Documents folder to the Harness', () => {
    expect(documentsDirectory(documents, home)).toBe(documents)
    expect(documentsDirectory(path.join(home, 'Dokumente') + path.sep, home)).toBe(path.join(home, 'Dokumente'))
    expect(documentsEnvironment(documents, home)).toEqual({ [DOCUMENTS_DIRECTORY_ENV]: documents })
  })

  it('never puts the workspace folder loose in home', () => {
    expect(documentsDirectory(home, home)).toBe(documents)
    expect(documentsDirectory(home + path.sep, home)).toBe(documents)
    expect(documentsDirectory(path.join(home, '.') + path.sep, home + path.sep)).toBe(documents)
  })

  it('leaves the lookup to the Harness when Electron has no usable answer', () => {
    expect(documentsDirectory(undefined, home)).toBeUndefined()
    expect(documentsDirectory('', home)).toBeUndefined()
    expect(documentsDirectory('Documents', home)).toBeUndefined()
    expect(documentsEnvironment(undefined, home)).toEqual({})
  })
})

describe('first-use workspace composition', () => {
  it('gives the workspace controller the Desktop Documents folder and product folder name, in normal and Safe Mode', async () => {
    for (const file of ['dsh-desktop.patch.yml', 'dsh-desktop-safe.patch.yml']) {
      const patch = await read('build', file)
      expect(patch, file).toMatch(/- id: workspace-controller\r?\n\s+config:\r?\n\s+documentsDirectory: !!js process\.env\.DSH_DESKTOP_DOCUMENTS_DIR \|\| undefined\r?\n\s+defaultFolderName: unoblox works/u)
    }
    expect(DOCUMENTS_DIRECTORY_ENV).toBe('DSH_DESKTOP_DOCUMENTS_DIR')
  })

  it('relies on the controller patch that makes the folder name configurable', async () => {
    const controller = await read('node_modules', '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'index.js')
    expect(controller).toContain('defaultFolderName: z.string().default("deepseek-harness")')
    expect(controller).toContain('return paths.join(directory, folderName, DEFAULT_WORKSPACE_DIRECTORY);')
    expect(controller).toContain('AbortSignal.any([signal, timeout]), {}, this.config.defaultFolderName)')
  })
})
