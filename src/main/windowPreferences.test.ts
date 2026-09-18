import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWindowPreferences } from './windowPreferences'

const dirs: string[] = []
const profile = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'prism-prefs-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('preferences across independent windows', () => {
  it('notifies existing windows when another process changes a shared key', async () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    const notify = vi.fn()
    const stop = primary.watch(notify)
    try {
      createWindowPreferences(owner, true).set({ key: 'prism.quickAccess', value: '["new"]' })
      await vi.waitFor(() =>
        expect(notify).toHaveBeenCalledWith({
          values: { 'prism.quickAccess': '["new"]' },
          removed: [],
          shared: false
        })
      )
    } finally {
      stop()
    }
  })
  it('inherits primary preferences without copying tabs, file positions or phone data', () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    primary.seed({
      'prism.theme': 'dark',
      'prism.onboarded': '1',
      'prism.docpos.secret': '42',
      unrelated: 'secret'
    })
    expect(createWindowPreferences(owner, true).load().values).toEqual({
      'prism.theme': 'dark',
      'prism.onboarded': '1'
    })
  })
  it('preserves changes from different windows and prevents stale primary reseeding', () => {
    const owner = profile()
    const first = createWindowPreferences(owner, false)
    const second = createWindowPreferences(owner, true)
    first.seed({ 'prism.theme': 'dark', 'prism.quickAccess': '["old"]' })
    second.set({ key: 'prism.quickAccess', value: '["new"]' })
    first.set({ key: 'prism.theme', value: 'light' })
    const restarted = createWindowPreferences(owner, false)
    restarted.seed({ 'prism.theme': 'dark', 'prism.quickAccess': '["old"]' })
    expect(restarted.load().values).toEqual({
      'prism.theme': 'light',
      'prism.quickAccess': '["new"]'
    })
  })
  it('persists deletions so an older window cannot resurrect an opt-out on startup', () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    primary.seed({ 'prism.theme': 'dark' })
    expect(createWindowPreferences(owner, true).set({ key: 'prism.theme', value: null })).toBe(true)
    expect(primary.seed({ 'prism.theme': 'dark' }).removed).toContain('prism.theme')
    expect(primary.load().values).not.toHaveProperty('prism.theme')
  })
  it('rejects invalid keys and values and never seeds from a child profile', () => {
    const child = createWindowPreferences(profile(), true)
    expect(child.seed({ 'prism.theme': 'old' }).values).toEqual({})
    expect(child.set({ key: '../../outside', value: 'bad' })).toBe(false)
    expect(child.set({ key: 'prism.theme', value: 12 })).toBe(false)
    expect(child.set(null)).toBe(false)
  })
})
