import { describe, expect, it } from 'vitest'
import { parseReleaseNotes } from '../shared/releaseNotes'
import {
  PREVIEW_FLAG,
  PREVIEW_MS,
  SAMPLE_NOTES,
  previewUpdate,
  previewVersion,
  runPreviewInstall,
  wantsPreview
} from './updatePreview'

describe('wantsPreview', () => {
  it('is the flag, wherever Chromium has moved it to', () => {
    expect(PREVIEW_FLAG).toBe('--preview-update')
    expect(wantsPreview(['app.exe', '--preview-update'])).toBe(true)
    expect(
      wantsPreview(['app.exe', '--user-data-dir=x', '--e2e', 'main.js', '--preview-update', 'C:/f'])
    ).toBe(true)
  })
  it('is nothing else', () => {
    expect(wantsPreview(['app.exe'])).toBe(false)
    expect(
      wantsPreview(['app.exe', '--preview-updates', 'preview-update', '--PREVIEW-UPDATE=1'])
    ).toBe(false)
    expect(wantsPreview([])).toBe(false)
  })
})

describe('previewVersion', () => {
  it('is the next minor, so the fake reads like the release that would follow', () => {
    expect(previewVersion('0.4.0')).toBe('0.5.0')
    expect(previewVersion('0.4.7')).toBe('0.5.0')
    expect(previewVersion('1.19.3')).toBe('1.20.0')
    expect(previewVersion('v2.0.1')).toBe('2.1.0')
  })
  it('still answers when the version is not one', () => {
    expect(previewVersion('')).toBe('0.1.0')
    expect(previewVersion('nightly')).toBe('0.1.0')
    expect(previewVersion('3')).toBe('3.1.0')
  })
})

describe('previewUpdate', () => {
  const info = previewUpdate('0.4.0')
  it('is marked as a mock and names no download', () => {
    expect(info).toEqual({ version: '0.5.0', url: '', notes: SAMPLE_NOTES, mock: true })
  })
  it('carries a body shaped like a real generated one, so the parser is what is previewed', () => {
    expect(SAMPLE_NOTES).toMatch(/## What's Changed/)
    expect(SAMPLE_NOTES).toMatch(/ by @\w+ in https:\/\//)
    expect(SAMPLE_NOTES).toMatch(/\*\*Full Changelog\*\*/)
    expect(SAMPLE_NOTES).toMatch(/## New Contributors/)
    const notes = parseReleaseNotes(SAMPLE_NOTES)
    expect(notes.empty).toBe(false)
    expect(notes.entries.length).toBeGreaterThanOrEqual(5)
    expect(notes.entries.join('\n')).not.toMatch(/by @|https?:|Full Changelog|first contribution/)
  })
  it('contains no em-dash, which neither app prints anywhere', () => {
    expect(SAMPLE_NOTES).not.toMatch(/\u2014/)
  })
})

describe('runPreviewInstall', () => {
  /** A clock the test owns: every wait is recorded and returns at once. */
  const fakeClock = (): { waits: number[]; wait: (ms: number) => Promise<void> } => {
    const waits: number[] = []
    return { waits, wait: (ms) => (waits.push(ms), Promise.resolve()) }
  }

  it('climbs from 0 to 100 without ever going back, and ends on exactly 100', async () => {
    const seen: number[] = []
    const clock = fakeClock()
    await runPreviewInstall((p) => seen.push(p), { wait: clock.wait })
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(100)
    expect(seen.filter((p) => p === 100)).toHaveLength(1)
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1])
    for (const p of seen) expect(Number.isInteger(p)).toBe(true)
  })

  it('takes about three seconds in all, the last part of it spent "installing"', async () => {
    const clock = fakeClock()
    await runPreviewInstall(() => {}, { wait: clock.wait })
    const total = clock.waits.reduce((a, b) => a + b, 0)
    expect(total).toBe(PREVIEW_MS)
    expect(total).toBeGreaterThanOrEqual(2500)
    expect(total).toBeLessThanOrEqual(3500)
    // The hold after 100%: long enough for the chip's "Installing" to be read.
    expect(clock.waits.at(-1)).toBeGreaterThanOrEqual(500)
  })

  it('stops where it is when cancelled, and still answers false (#32)', async () => {
    const seen: number[] = []
    const clock = fakeClock()
    const ok = await runPreviewInstall((p) => seen.push(p), {
      wait: clock.wait,
      cancelled: () => seen.length >= 5
    })
    expect(ok).toBe(false)
    expect(seen).toHaveLength(5)
    expect(seen.at(-1)).toBeLessThan(100)
  })

  it('resolves false: nothing was installed, which is what the caller reports', async () => {
    expect(await runPreviewInstall(() => {}, { wait: fakeClock().wait })).toBe(false)
  })

  it('runs on a real clock too', async () => {
    const seen: number[] = []
    const t0 = Date.now()
    await runPreviewInstall((p) => seen.push(p), { ms: 120 })
    expect(seen.at(-1)).toBe(100)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100)
  })
})
