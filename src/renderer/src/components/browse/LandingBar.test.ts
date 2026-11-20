import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { LandingBar } from './LandingBar'

// A row and a tile share one landing view and one bar (#524).
const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('the landing bar', () => {
  it('reads the percent through landingTile: clamped and whole', () => {
    expect(renderToStaticMarkup(createElement(LandingBar, { pct: 33.6 }))).toContain('aria-valuenow="34"')
    expect(renderToStaticMarkup(createElement(LandingBar, { pct: 180 }))).toContain('aria-valuenow="100"')
    expect(renderToStaticMarkup(createElement(LandingBar, { pct: undefined }))).toContain('aria-valuenow="0"')
  })

  it('is the thin, named bar with the landing class', () => {
    const html = renderToStaticMarkup(createElement(LandingBar, { pct: 10, className: 'browse-tile-landing' }))
    expect(html).toContain('browse-landing browse-tile-landing')
    expect(html).toContain('aria-label="Copying"')
  })

  it('the row and the tile draw it, and the row does not write "Copying…" itself', () => {
    expect(src('BrowseList.tsx')).toMatch(/<LandingBar/)
    expect(src('GridTile.tsx')).toMatch(/<LandingBar/)
    expect(src('BrowseList.tsx')).not.toMatch(/'Copying…'/)
    expect(src('BrowseList.tsx')).toMatch(/landingTile\(/)
  })
})