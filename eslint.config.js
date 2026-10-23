import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // docs/ holds standalone browser pages (the visualizer lab), not app source.
  // build/ is installer tooling: Node scripts and NSIS, none of it shipped.
  // .demo/ and videos/ are recording and render working files, rebuilt by
  // tools/showcase and never imported by the app. .e2e/ is generated fixtures,
  // some of them broken on purpose so the viewer has an error to underline.
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'docs/**',
      'build/**',
      '.demo/**',
      '.e2e/**',
      'videos/**',
      '**/*.d.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    // THE CORE STAYS EMBEDDABLE (#15, ported from Prism Terminal's wall). The core is
    // compiled by whatever app hosts it, so it may not reach for anything only one host
    // has. A path alias is resolved against the CONSUMER's tree (measured: silently, with
    // no error, the core ran the host's copy of a file), the host's src/ is not the core's
    // to import, `electron` is the host's to load, and the bridge to main is handed in
    // through renderer/host, never taken off a global. The window chrome is a host's own
    // idea and would overwrite another host's styles if the core pulled it in.
    files: ['packages/term-core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@shared/*', '@renderer/*', '@core/*'], message: 'No path aliases inside the core: a consumer resolves them against its own tree. Use a relative import.' },
            { group: ['**/src/*', '**/src/**'], message: 'The core may not import from a host app.' },
            { group: ['**/chromeTheme', '**/chromeTheme.*'], message: "chromeTheme is a host's window chrome; inside the core it would overwrite the app's styles." }
          ],
          paths: [{ name: 'electron', message: 'The core never imports electron: the host passes what it needs (ipcMain, ipcRenderer, clipboard).' }]
        }
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'prism', message: 'The core reaches main through termApi() (renderer/host), never through a global.' }
      ]
    }
  },
  {
    // tools/ runs on Node, drives a browser through Playwright, and injects the
    // odd snippet into a page: it needs both sets of globals and none of the
    // React rules.
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  prettier
)
