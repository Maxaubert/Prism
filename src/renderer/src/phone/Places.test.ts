import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { DriveRow } from './Places'

// The phone's drive row does the Explorer's sums (lib/driveUsage, #524).
const draw = (total: number, free: number): string =>
  renderToStaticMarkup(
    createElement(DriveRow, { drive: { path: 'C:\\', name: 'C:', kind: 'fixed', total, free } as never, onPick: () => {} })
  )

describe('the phone drive row', () => {
  it('says "free of" the way the Explorer does', () => {
    expect(draw(1000 * 1024 ** 3, 400 * 1024 ** 3)).toMatch(/free of/)
    expect(draw(1000 * 1024 ** 3, 400 * 1024 ** 3)).not.toContain('data-warn')
  })

  it('turns the bar and the line to the warning colour from 90 percent used', () => {
    const html = draw(1000, 100)
    expect(html).toContain('data-warn')
    expect(html).toContain('var(--p-warn)')
    expect(html).toContain('var(--p-warn-ink)')
    expect(draw(1000, 101)).not.toContain('data-warn')
  })

  it('draws no bar for a drive that gave no sizes', () => {
    const html = renderToStaticMarkup(createElement(DriveRow, { drive: { path: 'D:\\', name: 'D:' } as never, onPick: () => {} }))
    expect(html).not.toContain('free of')
  })
})