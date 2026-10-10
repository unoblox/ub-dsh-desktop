delete process.env.ELECTRON_RUN_AS_NODE
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Release builds ignore the update feed test hooks (src/main/update/update-policy.ts).
      __UNOBLOX_UPDATE_TEST_HOOKS__: JSON.stringify(process.env.UNOBLOX_WORKS_UPDATE_TEST_BUILD === '1')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  }
})
