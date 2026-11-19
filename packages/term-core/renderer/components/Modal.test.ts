import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYER, SCRIM } from './layers'
import { returnsFocus } from './Modal'

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
  it('has one scrim, a layer to name, a press that keeps the focus and a locked window that takes no menu or drop (#513)', () => {
    const src = readFileSync(join(__dirname, 'Modal.tsx'), 'utf8')
    expect(SCRIM).toContain('--p-scrim')
    expect(src).toContain('scrim = SCRIM')
    expect(src).toContain('layer = LAYER.modal')
    expect(src).toMatch(/e\.preventDefault\(\)\s+if \(!live\.current\.locked\)/)
    expect(src).toContain('onContextMenu={locked')
    expect(src).toContain('onDrop={locked')
    expect(LAYER.busy).toBe('z-[90]')
  })
  it('gives the focus back on close only when nothing else has taken it', () => {
    const body = {}
    const chip = { isConnected: true }
    expect(returnsFocus(chip, body, body)).toBe(true)
    expect(returnsFocus(chip, null, body)).toBe(true)
    // The close question opened over the update window and holds the focus.
    expect(returnsFocus(chip, { isConnected: true }, body)).toBe(false)
    expect(returnsFocus({ isConnected: false }, body, body)).toBe(false)
    expect(returnsFocus(body as { isConnected: boolean }, body, body)).toBe(false)
  })
})
