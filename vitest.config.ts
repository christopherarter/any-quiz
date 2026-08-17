import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // passWithNoTests is a root-only option in Vitest (excluded from per-project
    // config by its own types); it must live here to keep `npm run check` green
    // while the browser project matches zero files, in the early tasks of this plan.
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx'],
          setupFiles: ['test/setup-dom.ts'],
        },
      },
    ],
  },
})
