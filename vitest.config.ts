import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Tests point the updater at local feeds, as a test build does.
  define: { __UNOBLOX_UPDATE_TEST_HOOKS__: 'true' },
  test: {
    include: ['test/**/*.{test,spec}.{ts,js,mjs}'],
    // Native Intel runners and Windows CI contend for CPU and disk while integration suites
    // unpack archives and launch subprocesses (hitting EBUSY locks). Keep every test, but serialize files.
    fileParallelism: !(
      process.env.CI &&
      ((process.platform === 'darwin' && process.arch === 'x64') || process.platform === 'win32')
    ),
    testTimeout: 60_000
  }
})
