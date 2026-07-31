import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tests only (pure logic under src/). The aliases mirror
// electron.vite.config.ts so test imports match app imports.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
