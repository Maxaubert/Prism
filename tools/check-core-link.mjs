import { fileURLToPath } from 'node:url'
import { assertCoreLink } from './lib/coreLink.mjs'

// Run by the e2e and package scripts; see lib/coreLink.mjs.
try {
  assertCoreLink(fileURLToPath(new URL('..', import.meta.url)))
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
