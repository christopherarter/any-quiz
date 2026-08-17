import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Build only. Vitest has its own config so test globs are not tangled with `root: 'app'`.
export default defineConfig({
  root: 'app',
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Stable filenames: the server sends `cache-control: no-store`, so content
    // hashes buy nothing and would churn the committed bundle on every build.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:4711' } },
})
