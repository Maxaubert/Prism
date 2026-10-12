import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// EVERY DIALOG IS THE MODAL (audit 2026-10-12): six dialogs each wrote their
// own scrim, Escape and Tab handling and had drifted (the close question let
// Tab out into the shell). Only Modal.tsx may declare a modal; a dialog is a
// caller of it. The colour picker only LOOKS for one, to sit inside it.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) ? [p] : []
  })

describe('dialogs', () => {
  it('are drawn by Modal: no other file declares aria-modal', () => {
    const root = join(__dirname, '..')
    const own = walk(root)
      .filter((f) => readFileSync(f, 'utf8').split('[aria-modal="true"]').join('').includes('aria-modal'))
      .map((f) => relative(root, f).replace(/\\/g, '/'))
    expect(own).toEqual(['components/Modal.tsx'])
  })
  it('the Modal traps a plain Tab, swallows Escape and carves out the drag region', () => {
    const src = readFileSync(join(__dirname, 'Modal.tsx'), 'utf8')
    expect(src).toContain("e.key === 'Tab' && !e.ctrlKey")
    expect(src).toContain("e.key === 'Escape'")
    expect(src).toContain('className={`no-drag fixed inset-0')
  })
})
