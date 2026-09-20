import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: resolve(__dirname, '.vite/build'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/preload/index.ts'),
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'preload.js', inlineDynamicImports: true }
    }
  }
})
