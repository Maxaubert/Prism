import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'
import { missingFromAsar, requiredPackages } from './lib/packedDeps.mjs'

/**
 * electron-builder's afterPack hook (2026-10-14): THE INSTALLER NEVER SHIPS
 * WITHOUT A MODULE THE APP NEEDS. Runs on every package, here and in the
 * release workflow, after the app is packed and before the installer is made,
 * and fails the build naming each missing package. Why it exists is in
 * `lib/packedDeps.mjs` (a junctioned node_modules once packed 60 of 246).
 *
 * Also a command: `node tools/check-packed.mjs dist/win-unpacked`.
 */
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function checkPacked(appOutDir) {
  const asar = join(appOutDir, 'resources', 'app.asar')
  const unpacked = join(appOutDir, 'resources', 'app.asar.unpacked')
  const { packages, missing: notInstalled } = requiredPackages(ROOT)
  const missing = missingFromAsar(packages, listPackage(asar, { isPack: false }), (dir) =>
    existsSync(join(unpacked, dir, 'package.json'))
  )
  if (notInstalled.length || missing.length) {
    const lines = [
      ...notInstalled.map((m) => `  not installed: ${m}`),
      ...missing.map((m) => `  not packed: ${m}`)
    ]
    throw new Error(
      `The packed app is missing ${notInstalled.length + missing.length} of the ${packages.length} packages it needs ` +
        `(a junctioned node_modules packs only the direct ones; package with a real copy):\n${lines.join('\n')}`
    )
  }
  console.log(`  • packed modules  all ${packages.length} the app needs are in app.asar`)
}

export default async function afterPack(context) {
  checkPacked(context.appOutDir)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkPacked(resolve(process.argv[2] ?? join(ROOT, 'dist', 'win-unpacked')))
  } catch (err) {
    console.error(String(err?.message ?? err))
    process.exit(1)
  }
}
