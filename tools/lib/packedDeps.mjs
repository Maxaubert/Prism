import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

/**
 * WHAT THE APP NEEDS AT RUN TIME, AND WHETHER THE ASAR HAS IT (2026-10-14).
 *
 * The installed 0.106.8 died at launch with "Cannot find module 'dijkstrajs'"
 * (qrcode's dependency, loaded by the phone server). It had been packaged in a
 * worktree whose node_modules was a JUNCTION to the main checkout, and
 * electron-builder packed only the direct dependencies through it: 60 of 246
 * top-level modules. Nothing failed until the owner opened the app.
 *
 * So the build checks itself: every package `dependencies` reaches, walked the
 * way Node resolves it (a nested node_modules first, then the top), must be in
 * the asar or beside it unpacked. Pure apart from reading package.json files,
 * so `packedDeps.test.mjs` can hand it a fake tree.
 */

/** The installed packages the app's `dependencies` reach, as relative
 *  `node_modules/...` directories, each once. An optional dependency that is
 *  not installed is skipped (it is optional); a required one that is not
 *  installed is reported as `missing` rather than thrown, so the caller can
 *  say everything at once. */
export function requiredPackages(root) {
  const read = (dir) => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  const top = read('.')
  const found = new Set()
  const missing = []
  const queue = [{ from: '.', deps: top.dependencies ?? {}, optional: top.optionalDependencies ?? {} }]
  while (queue.length) {
    const { from, deps, optional } = queue.shift()
    const names = [...new Set([...Object.keys(deps), ...Object.keys(optional)])]
    for (const name of names) {
      const dir = resolveFrom(root, from, name)
      if (!dir) {
        if (!(name in optional)) missing.push(`${name} (needed by ${from === '.' ? 'the app' : from})`)
        continue
      }
      if (found.has(dir)) continue
      found.add(dir)
      const pkg = read(dir)
      queue.push({ from: dir, deps: pkg.dependencies ?? {}, optional: pkg.optionalDependencies ?? {} })
    }
  }
  return { packages: [...found].sort(), missing }
}

/** Node's lookup: `from/node_modules/name`, then each parent's, up to the top. */
function resolveFrom(root, from, name) {
  let at = from
  for (;;) {
    const dir = at === '.' ? posix.join('node_modules', name) : posix.join(at, 'node_modules', name)
    if (existsSync(join(root, dir, 'package.json'))) return dir
    if (at === '.') return null
    const i = at.lastIndexOf('/node_modules/')
    at = i < 0 ? '.' : at.slice(0, i)
  }
}

/** A package's name from where it sits: the part after the last
 *  `node_modules/`, scope included. */
export function packageName(dir) {
  const parts = dir.replace(/\\/g, '/').split('/node_modules/').pop().replace(/^node_modules\//, '').split('/')
  return (parts[0].startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/').toLowerCase()
}

/** The required packages with no package.json of that NAME anywhere in the
 *  asar's file list ("\node_modules\x\package.json" on Windows) or the
 *  unpacked folder. By name, not by place: electron-builder flattens a nested
 *  copy (mammoth's own bluebird) into the archive's top node_modules, so the
 *  place differs and the package is still there. */
export function missingFromAsar(packages, asarFiles, unpacked = () => false) {
  const packed = new Set(
    asarFiles
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => /\/node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(p))
      .map((p) => packageName(p.slice(0, -'/package.json'.length)))
  )
  return packages.filter((dir) => !packed.has(packageName(dir)) && !unpacked(dir))
}
