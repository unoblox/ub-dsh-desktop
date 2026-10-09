import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOCUMENTS_DIRECTORY_ENV, documentsDirectory, documentsEnvironment } from '../src/main/runtime/documents-directory'

const projectRoot = path.resolve(import.meta.dirname, '..')
const read = (...parts: string[]) => readFile(path.join(projectRoot, ...parts), 'utf8')

describe('Documents folder for the first-use workspace', () => {
  it('passes Electron’s Documents folder to the Harness', () => {
    expect(documentsDirectory('/home/asha/Documents', '/home/asha')).toBe('/home/asha/Documents')
    expect(documentsDirectory('/home/asha/Dokumente/', '/home/asha')).toBe('/home/asha/Dokumente')
    expect(documentsEnvironment('/home/asha/Documents', '/home/asha')).toEqual({ [DOCUMENTS_DIRECTORY_ENV]: '/home/asha/Documents' })
  })

  it('never puts the workspace folder loose in home', () => {
    expect(documentsDirectory('/home/asha', '/home/asha')).toBe('/home/asha/Documents')
    expect(documentsDirectory('/home/asha/', '/home/asha')).toBe('/home/asha/Documents')
    expect(documentsDirectory('/home/asha/./', '/home/asha/')).toBe('/home/asha/Documents')
  })

  it('leaves the lookup to the Harness when Electron has no usable answer', () => {
    expect(documentsDirectory(undefined, '/home/asha')).toBeUndefined()
    expect(documentsDirectory('', '/home/asha')).toBeUndefined()
    expect(documentsDirectory('Documents', '/home/asha')).toBeUndefined()
    expect(documentsEnvironment(undefined, '/home/asha')).toEqual({})
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
