import { join, resolve } from 'path'
import { cpSync, createReadStream, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * THE CORE'S PLAIN .ts SETTINGS MODULES THE PACKAGE DOES NOT EXPORT (#292).
 * prism-term-core's `exports` maps `./renderer/settings/*` to `.tsx` only, so
 * `coreIndex`, `sectionIds` and `layout/icons` (Find a setting's index, the
 * section ids, the icon names) cannot be imported by package path. Each is
 * resolved to its file here, by its exact specifier, until the core exports
 * them; the same list is in `vitest.config.ts` and `tsconfig.web.json`.
 */
const CORE_TS = [
  'renderer/settings/coreIndex',
  'renderer/settings/sectionIds',
  'renderer/settings/layout/icons',
  // The Diagnostics rows' list (#322), read by the settings tests.
  'renderer/settings/diagnosticsOptions'
]

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
      alias: [
        { find: '@renderer', replacement: resolve('src/renderer/src') },
        { find: '@shared', replacement: resolve('src/shared') },
        ...CORE_TS.map((m) => ({ find: new RegExp(`^prism-term-core/${m}$`), replacement: resolve(`node_modules/prism-term-core/${m}.ts`) }))
      ],
      // THE TERMINAL COMES FROM prism-term-core (the `core/` of PrismTerminal, #154).
      // It ships TypeScript SOURCE and is a DEV dependency on purpose, so
      // electron-vite compiles it in and nothing extra is packaged. A linked
      // checkout resolves react from ITS OWN node_modules: measured, two Reacts
      // in one bundle, double the size, broken hooks.
      dedupe: ['react', 'react-dom']
    },
    // Served as source, never pre-bundled: a pre-bundled copy goes stale when
    // the core is edited through a link, and reloads the page mid-session.
    optimizeDeps: { exclude: ['prism-term-core'] },
    plugins: [react(), tailwindcss(), pdfSideData()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // The phone page (#104): served over the LAN by src/main/phone, out
          // of the same renderer dir, sharing the viewers and the style tokens.
          phone: resolve(__dirname, 'src/renderer/phone.html')
        }
      }
    }
  }
})
