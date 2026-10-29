import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
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
  it("hears its own write as nothing, and another window's as a change (perf review #45)", async () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    const notify = vi.fn()
    const stop = primary.watch(notify)
    try {
      primary.set({ key: 'prism.theme', value: 'dark' })
      await primary.idle()
      // Past the watch's 25 ms settle and its look at the named file.
      await new Promise((r) => setTimeout(r, 300))
      expect(notify).not.toHaveBeenCalled()
      createWindowPreferences(owner, true).set({ key: 'prism.quickAccess', value: '["x"]' })
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
      expect(notify.mock.calls[0][0].values).toEqual({ 'prism.theme': 'dark', 'prism.quickAccess': '["x"]' })
    } finally {
      stop()
    }
  })
  it('inherits primary preferences without copying tabs, file positions or phone data', async () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    primary.seed({
      'prism.theme': 'dark',
      'prism.onboarded': '1',
      'prism.docpos.secret': '42',
      unrelated: 'secret'
    })
    await primary.idle()
    expect(createWindowPreferences(owner, true).load().values).toEqual({
      'prism.theme': 'dark',
      'prism.onboarded': '1'
    })
  })
  it('preserves changes from different windows and prevents stale primary reseeding', async () => {
    const owner = profile()
    const first = createWindowPreferences(owner, false)
    const second = createWindowPreferences(owner, true)
    first.seed({ 'prism.theme': 'dark', 'prism.quickAccess': '["old"]' })
    await first.idle()
    second.set({ key: 'prism.quickAccess', value: '["new"]' })
    first.set({ key: 'prism.theme', value: 'light' })
    await Promise.all([first.idle(), second.idle()])
    const restarted = createWindowPreferences(owner, false)
    restarted.seed({ 'prism.theme': 'dark', 'prism.quickAccess': '["old"]' })
    expect(restarted.load().values).toEqual({
      'prism.theme': 'light',
      'prism.quickAccess': '["new"]'
    })
  })
  it('persists deletions so an older window cannot resurrect an opt-out on startup', async () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    primary.seed({ 'prism.theme': 'dark' })
    await primary.idle()
    const other = createWindowPreferences(owner, true)
    expect(other.set({ key: 'prism.theme', value: null })).toBe(true)
    await other.idle()
    // In the app the folder watch does this.
    await primary.refresh()
    expect(primary.seed({ 'prism.theme': 'dark' }).removed).toContain('prism.theme')
    expect(primary.load().values).not.toHaveProperty('prism.theme')
  })
  it('deletes retired keys from the store and never loads them (2026-10-28)', async () => {
    const owner = profile()
    const writer = createWindowPreferences(owner, false)
    writer.set({ key: 'prism.quickAccess', value: '["kept"]' })
    writer.set({ key: 'prism.term.colourFormat', value: 'hex' })
    await writer.idle()
    // A retired key as an older Prism wrote it: same file naming, same shape.
    const dir = join(owner, 'window-preferences')
    const name = `${createHash('sha256').update('prism.term.shell').digest('hex')}.json`
    writeFileSync(join(dir, name), JSON.stringify({ key: 'prism.term.shell', value: 'pwsh' }))
    const store = createWindowPreferences(owner, false)
    expect(store.load().values).toEqual({ 'prism.quickAccess': '["kept"]', 'prism.term.colourFormat': 'hex' })
    expect(store.set({ key: 'prism.term.shell', value: 'cmd' })).toBe(false)
    await store.idle()
    expect(readdirSync(dir)).not.toContain(name)
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it('rejects invalid keys and values and never seeds from a child profile', () => {
    const child = createWindowPreferences(profile(), true)
    expect(child.seed({ 'prism.theme': 'old' }).values).toEqual({})
    expect(child.set({ key: '../../outside', value: 'bad' })).toBe(false)
    expect(child.set({ key: 'prism.theme', value: 12 })).toBe(false)
    expect(child.set(null)).toBe(false)
  })
})

describe('answers from memory, writes behind (2026-10-12)', () => {
  it('answers a set at once and writes it atomically after', async () => {
    const owner = profile()
    const prefs = createWindowPreferences(owner, false)
    expect(prefs.set({ key: 'prism.theme', value: 'light' })).toBe(true)
    expect(prefs.load().values).toEqual({ 'prism.theme': 'light' })
    await prefs.idle()
    expect(createWindowPreferences(owner, true).load().values).toEqual({ 'prism.theme': 'light' })
    expect(readdirSync(join(owner, 'window-preferences')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
  it('the newest of several quick writes to one key is the one on disk', async () => {
    const owner = profile()
    const prefs = createWindowPreferences(owner, false)
    for (let i = 0; i < 20; i += 1) prefs.set({ key: 'prism.quickAccess', value: String(i) })
    prefs.set({ key: 'prism.quickAccess', value: null })
    prefs.set({ key: 'prism.quickAccess', value: 'last' })
    await prefs.idle()
    expect(createWindowPreferences(owner, true).load().values['prism.quickAccess']).toBe('last')
  })
  it('a disk read that began before a change does not put the old value back', async () => {
    const owner = profile()
    const prefs = createWindowPreferences(owner, false)
    prefs.set({ key: 'prism.theme', value: 'dark' })
    await prefs.idle()
    const reading = prefs.refresh()
    prefs.set({ key: 'prism.theme', value: 'light' })
    await reading
    expect(prefs.load().values['prism.theme']).toBe('light')
    await prefs.idle()
    expect((await prefs.refresh()).values['prism.theme']).toBe('light')
  })
  it("a seed never overwrites a file another window kept, and takes that window's value", async () => {
    const owner = profile()
    const primary = createWindowPreferences(owner, false)
    const other = createWindowPreferences(owner, true)
    other.set({ key: 'prism.theme', value: 'light' })
    await other.idle()
    // Primary has not read it yet: its seed goes to disk only if absent, and loses.
    primary.seed({ 'prism.theme': 'dark' })
    await primary.idle()
    expect(primary.load().values['prism.theme']).toBe('light')
    expect(createWindowPreferences(owner, true).load().values['prism.theme']).toBe('light')
  })
  it('the quit flush writes what is still pending, synchronously', () => {
    const owner = profile()
    const prefs = createWindowPreferences(owner, false)
    prefs.set({ key: 'prism.theme', value: 'light' })
    prefs.flush()
    expect(createWindowPreferences(owner, true).load().values).toEqual({ 'prism.theme': 'light' })
  })
  it('ignores a damaged file on refresh', async () => {
    const owner = profile()
    const prefs = createWindowPreferences(owner, false)
    prefs.set({ key: 'prism.theme', value: 'light' })
    await prefs.idle()
    const damaged = join(owner, 'window-preferences', `${'a'.repeat(64)}.json`)
    writeFileSync(damaged, '{bad')
    expect((await prefs.refresh()).values).toEqual({ 'prism.theme': 'light' })
    expect(readFileSync(damaged, 'utf8')).toBe('{bad')
  })
})
