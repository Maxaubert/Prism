import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Slider } from 'prism-term-core/renderer/settings/fields'

// One slider (#524): the core's, in the Settings page and in the player menu.
const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
const base = { value: 50, max: 100, onChange: () => {}, label: 'Band', format: (v: number) => `${v}%` }

describe('the one slider', () => {
  it('a row slider says its value beside it and takes a step and an id', () => {
    const html = renderToStaticMarkup(createElement(Slider, { ...base, step: 5, id: 'transport-bg' }))
    expect(html).toContain('step="5"')
    expect(html).toContain('id="transport-bg"')
    expect(html).toContain('data-slider-value')
    expect(html).toContain('50%')
  })

  it('the menu variant fills the width and says nothing beside it', () => {
    const html = renderToStaticMarkup(
      createElement(Slider, { ...base, variant: 'menu', data: { 'data-menu-slider': '' } })
    )
    expect(html).toContain('w-full')
    expect(html).not.toContain('w-[168px]')
    expect(html).not.toContain('data-slider-value')
    expect(html).toContain('data-menu-slider')
  })

  it('the media page and the player menu draw no native range of their own', () => {
    for (const f of ['components/settings/MediaPage.tsx', 'components/PlayerMenu.tsx']) {
      expect(src(f), f).not.toMatch(/type="range"/)
      expect(src(f), f).toMatch(/<Slider/)
    }
  })
})