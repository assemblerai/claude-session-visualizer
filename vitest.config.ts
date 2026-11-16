import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * One runner, two projects: the renderer needs a DOM, the main process must
 * never have one. Aliases are duplicated from `electron.vite.config.ts` and must
 * move together.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@renderer': resolve(__dirname, 'src/renderer/src'),
            '@shared': resolve(__dirname, 'src/shared'),
          },
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.spec.{ts,tsx}'],
          setupFiles: [resolve(__dirname, 'src/renderer/src/test-setup.ts')],
        },
      },
      {
        resolve: {
          alias: { '@shared': resolve(__dirname, 'src/shared') },
        },
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.spec.ts', 'src/preload/**/*.spec.ts', 'src/shared/**/*.spec.ts'],
        },
      },
    ],
  },
})
