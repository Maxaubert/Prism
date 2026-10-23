import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coreLinkProblem } from './coreLink.mjs'

function checkout() {
  const root = mkdtempSync(join(tmpdir(), 'pt-corelink-'))
  mkdirSync(join(root, 'packages', 'term-core'), { recursive: true })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  return root
}

describe('coreLinkProblem', () => {
  it('passes when node_modules/prism-term-core links to this checkout', () => {
    const root = checkout()
    symlinkSync(join(root, 'packages', 'term-core'), join(root, 'node_modules', 'prism-term-core'), 'junction')
    expect(coreLinkProblem(realpathSync(root))).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })

  it('names the other checkout when the link points elsewhere (the worktree trap)', () => {
    const root = checkout()
    const main = checkout()
    symlinkSync(join(main, 'packages', 'term-core'), join(root, 'node_modules', 'prism-term-core'), 'junction')
    expect(coreLinkProblem(root)).toMatch(/another checkout/)
    rmSync(root, { recursive: true, force: true })
    rmSync(main, { recursive: true, force: true })
  })

  it('fails when the link is missing', () => {
    const root = checkout()
    expect(coreLinkProblem(root)).toMatch(/npm install/)
    rmSync(root, { recursive: true, force: true })
  })
})
