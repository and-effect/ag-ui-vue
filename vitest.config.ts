import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Node 25+ ships a global localStorage that is unusable without
    // --localstorage-file and shadows happy-dom's; turn it off.
    execArgv: ['--no-experimental-webstorage'],
  },
})
