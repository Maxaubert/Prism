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
    // tools/ runs on Node, drives a browser through Playwright, and injects the
    // odd snippet into a page: it needs both sets of globals and none of the
    // React rules.
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  prettier
)
