import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PATHS } from './paths'
import { KindIcon } from './FileIcons'
import { EntryIcon, GROUND_PAGE, GROUND_SIDE, entryGround } from './EntryIcon'

const draw = (props: Parameters<typeof EntryIcon>[0]): string => renderToStaticMarkup(createElement(EntryIcon, props))

describe('EntryIcon (#521)', () => {
  it('draws a folder as the one filled folder in the folder colour, at any size', () => {
    const html = draw({ kind: 'folder', size: 22 })
    expect(html).toContain(PATHS.folderFill)
    expect(html).toContain('fill="var(--p-tree-folder)"')
    expect(html).toContain('width="22"')
  })

  it('draws a file as its kind icon at the size asked, never the folder', () => {
    const el = EntryIcon({ kind: 'image', ext: '.png', name: 'a.png', size: 40 })
    expect(el.type).toBe(KindIcon)
    expect(el.props).toMatchObject({ kind: 'image', ext: '.png', name: 'a.png', size: 40, color: 'var(--p-tree-file)' })
  })

  it('cuts a file out to the colour behind it', () => {
    expect(entryGround(false, false, GROUND_PAGE)).toBe('var(--p-bg)')
    expect(entryGround(false, true, GROUND_SIDE)).toBe('var(--p-side-flat)')
    expect(entryGround(true, false, GROUND_SIDE)).toBe('var(--sel-seen, var(--p-sel-tint-seen))')
    expect(entryGround(true, true, GROUND_SIDE)).toBe('var(--p-sel-tint-dim-seen)')
    expect(EntryIcon({ kind: 'doc', selected: true, dimmed: true }).props.bg).toBe('var(--p-sel-tint-dim-seen)')
  })
})
