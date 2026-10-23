import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * THE CORE LINK PREFLIGHT (Phase 1 of moving the terminal core into Prism).
 *
 * `prism-term-core` is an npm workspace: `node_modules/prism-term-core` is a link to
 * `packages/term-core`. A worktree gets its node_modules by robocopy from main, and the
 * copy keeps main's link, so the worktree would build, test and package MAIN's core
 * while its own `packages/term-core` sits unused. This names that, before a run is
 * trusted. Fix: `npm install` in the worktree (it relinks).
 *
 * Returns null when the link is right, else the sentence to fail with.
 */
export function coreLinkProblem(root) {
  const link = join(root, 'node_modules', 'prism-term-core')
  const want = join(root, 'packages', 'term-core')
  if (!existsSync(want)) return `${want} does not exist`
  if (!existsSync(link)) return `${link} is missing: run npm install`
  const got = realpathSync.native(link)
  const exp = realpathSync.native(want)
  if (got.toLowerCase() !== exp.toLowerCase()) {
    return (
      `node_modules/prism-term-core resolves to ${got}, not ${exp}. ` +
      'This checkout would run another checkout\'s terminal core (a worktree whose ' +
      'node_modules was copied from main). Run npm install here to relink it.'
    )
  }
  return null
}

export function assertCoreLink(root) {
  const problem = coreLinkProblem(resolve(root))
  if (problem) throw new Error(`core link preflight failed: ${problem}`)
}
