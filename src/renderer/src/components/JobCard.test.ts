import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { JobCard } from './JobCard'
import { ProgressBar } from './ProgressBar'

// ONE PROGRESS COMPONENT (#501; owner, 2026-11-10): the card over a tab, the
// extract window and the landing bars are drawn by these two, so a file job
// looks the same whichever one it is. The card is MINIMAL: the title, the
// bar, the file being worked on, a small count and Cancel.

const draw = (props: Partial<Parameters<typeof JobCard>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(JobCard, {
      title: 'Copying 12 items',
      pct: 29,
      file: 'IMG_4823.HEIC',
      count: '3 of 12',
      onCancel: vi.fn(),
      ...props
    })
  )

describe('ProgressBar (one bar element for every job)', () => {
  it('is a progressbar with its value and a fill of that width', () => {
    const html = renderToStaticMarkup(createElement(ProgressBar, { pct: 40, label: 'Copying' }))
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('width:40%')
  })
  it('slides (indeterminate) while nothing is known, and says no value', () => {
    const html = renderToStaticMarkup(createElement(ProgressBar, { pct: null }))
    expect(html).toContain('data-indeterminate')
    expect(html).not.toContain('aria-valuenow')
  })
  it('clamps nonsense to 0-100', () => {
    expect(renderToStaticMarkup(createElement(ProgressBar, { pct: 180 }))).toContain('aria-valuenow="100"')
    expect(renderToStaticMarkup(createElement(ProgressBar, { pct: -5 }))).toContain('aria-valuenow="0"')
  })
  it('has a thin size (the rows) and a thick one (the card)', () => {
    expect(renderToStaticMarkup(createElement(ProgressBar, { pct: 1, size: 'thin' }))).toContain('data-size="thin"')
    expect(renderToStaticMarkup(createElement(ProgressBar, { pct: 1 }))).toContain('data-size="thick"')
  })
})

describe('JobCard (mockup B, cut down to minimal text)', () => {
  it('says the title, the file and the small count, and nothing more', () => {
    const html = draw()
    const text = html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')
    expect(text).toContain('Copying 12 items')
    expect(text).toContain('IMG_4823.HEIC')
    expect(text).toContain('3 of 12')
    expect(text).toContain('Cancel')
    // No bytes, no time left, no big percentage.
    expect(html).not.toMatch(/left|MB of|GB of/)
    expect(html).not.toMatch(/>29%</)
  })
  it('draws its bar with the shared ProgressBar', () => {
    const html = draw()
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="29"')
  })
  it('has one Cancel button, off when it cannot be pressed', () => {
    expect((draw().match(/<button/g) ?? []).length).toBe(1)
    expect(draw({ cancelDisabled: true })).toMatch(/<button[^>]*disabled/)
  })
  it('keeps a failed job on the same card: a stopped bar and a Close', () => {
    const html = draw({ stopped: true, action: { label: 'Close', onPress: vi.fn() }, file: 'Not enough space' })
    expect(html).toContain('data-stopped')
    expect(html).toContain('Close')
    expect(html).not.toContain('Cancel')
  })
})

describe('every long file job draws the one component', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')
  it('the hold, the extract window and the landing rows and tiles import ProgressBar or JobCard', () => {
    expect(read('./browse/BusyBar.tsx')).toContain('JobCard')
    expect(read('./ExtractWindow.tsx')).toContain('JobCard')
    expect(read('./browse/BrowseList.tsx')).toContain('ProgressBar')
    expect(read('./browse/GridTile.tsx')).toContain('ProgressBar')
  })
  it('and none keeps a bar of its own', () => {
    for (const f of ['./browse/BusyBar.tsx', './ExtractWindow.tsx', './browse/BrowseList.tsx', './browse/GridTile.tsx']) {
      const src = read(f)
      expect(src, f).not.toMatch(/browse-busy-fill|browse-landing-fill|data-extract-fill/)
    }
    const css = read('./browse/browse.css')
    expect(css).not.toMatch(/\.browse-busy-fill|\.browse-landing-fill|\.browse-busy-track/)
  })
})
