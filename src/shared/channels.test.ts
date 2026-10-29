import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALL, PUSH, SWEEP_CHANNELS } from './channels'

// The channel table is the one place a channel is spelled (2026-10-12). These
// hold it to that: no second spelling in main or the preload, and no entry
// one side of the bridge has forgotten.
const src = join(__dirname, '..')
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : []
  )
const read = (files: string[]): string => files.map((f) => readFileSync(f, 'utf8')).join('\n')
const main = read(sources(join(src, 'main')))
const preload = read(sources(join(src, 'preload')))

describe('the IPC channel table', () => {
  it('spells every channel once, as prefix:name', () => {
    const values = [...Object.values(PUSH), ...Object.values(CALL)]
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^[a-z0-9-]+:[a-zA-Z0-9-]+$/)
  })

  it('folds the sweep box in', () => {
    expect(SWEEP_CHANNELS).toEqual({
      begin: 'sweep-overlay:begin',
      update: 'sweep-overlay:update',
      end: 'sweep-overlay:end',
      state: 'sweep-overlay:state'
    })
  })

  it('is the only spelling in main and the preload', () => {
    const bare =
      /(?:ipcMain\.(?:handle|on|once|removeListener|removeHandler)|ipcRenderer\.(?:invoke|send|sendSync|on|removeListener)|\.send|sendToPage|sendToAll|sendToTabOwner)\(\s*'[a-z0-9-]+:/g
    expect(main.match(bare) ?? []).toEqual([])
    expect(preload.match(bare) ?? []).toEqual([])
  })

  it('carries no surface the desktop stopped using (2026-10-28)', () => {
    // The sidebar tree's search (the phone has its own `searchHere`) and the
    // one-file clipboard copy (the copy path is the multi-path call).
    expect('searchFiles' in CALL).toBe(false)
    expect(preload).not.toMatch(/\bsearchTree\b/)
    expect(preload).not.toMatch(/\bcopyFileToClipboard\b/)
  })

  it('leaves no entry one side has forgotten', () => {
    const sweep = (k: string): boolean => k.startsWith('sweepOverlay')
    for (const k of Object.keys(PUSH).filter((k) => !sweep(k))) {
      expect(main, `PUSH.${k} sent by main`).toContain(`PUSH.${k}`)
      expect(preload, `PUSH.${k} heard by the preload`).toContain(`PUSH.${k}`)
    }
    for (const k of Object.keys(CALL).filter((k) => !sweep(k))) {
      expect(main, `CALL.${k} answered by main`).toMatch(new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*CALL\\.${k}\\b`))
      expect(preload, `CALL.${k} asked by the preload`).toContain(`CALL.${k}`)
    }
    expect(main).toContain('SWEEP_CHANNELS.')
    expect(preload).toContain('SWEEP_CHANNELS.')
  })
})
