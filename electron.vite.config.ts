import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { normalizePath } from 'vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Forked as a utility process so HEIC decoding never blocks the main one.
          heicWorker: resolve(__dirname, 'src/main/heicWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      // pdf.js side data, served next to the bundle: character maps for CJK text
      // and the fourteen standard fonts a PDF may use without embedding them.
      viteStaticCopy({
        targets: [
          { src: normalizePath(resolve('node_modules/pdfjs-dist/cmaps')) + '/*', dest: 'pdf/cmaps' },
          {
            src: normalizePath(resolve('node_modules/pdfjs-dist/standard_fonts')) + '/*',
            dest: 'pdf/standard_fonts'
          }
        ]
      })
    ],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
