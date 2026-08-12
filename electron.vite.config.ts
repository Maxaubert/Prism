import { join, resolve } from 'path'
import { cpSync, createReadStream, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

// pdf.js side data (character maps, the fourteen standard fonts, wasm image
// decoders, ICC profiles), served next to the bundle as /pdf/<dir>/<file>.
// Hand-rolled: vite-plugin-static-copy rebases files from outside the Vite
// root under their full node_modules path on Windows, which 404s everything.
const PDF_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

function pdfSideData(): Plugin {
  let outDir = ''
  return {
    name: 'prism-pdf-side-data',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/pdf', (req, res, next) => {
        const [dir, ...rest] = (req.url ?? '').replace(/^\/+/, '').split('/')
        const file = rest.join('/').split('?')[0]
        const path = join(resolve(`node_modules/pdfjs-dist/${dir}`), decodeURIComponent(file))
        if (!PDF_DIRS.includes(dir) || file.includes('..') || !existsSync(path)) {
          next()
          return
        }
        res.setHeader(
          'Content-Type',
          path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
        )
        createReadStream(path).pipe(res)
      })
    },
    closeBundle() {
      for (const dir of PDF_DIRS) {
        cpSync(resolve(`node_modules/pdfjs-dist/${dir}`), join(outDir, 'pdf', dir), {
          recursive: true
        })
      }
    }
  }
}

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
    plugins: [react(), tailwindcss(), pdfSideData()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } }
  }
})
