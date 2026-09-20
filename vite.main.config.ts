import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: resolve(__dirname, '.vite/build'),
    emptyOutDir: true,
    ssr: resolve(__dirname, 'src/main/index.ts'),
    target: 'node22',
    rollupOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'index.js', inlineDynamicImports: true }
    }
  }
})
