import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { RenameField } from './RenameField'
import { GridTile } from './browse/GridTile'

const tile = (renameField?: ReactElement): string =>
  renderToStaticMarkup(
    createElement(GridTile, {
      name: 'a.txt',
      path: 'C:\\x\\a.txt',
      index: 0,
      rect: { x: 0, y: 0, w: 100, h: 120 },
      media: null,
      selected: true,
      primary: true,
      cursor: false,
      cut: false,
      landing: undefined,
      posInSet: 1,
      setSize: 1,
      handlers: { draggable: true },
      renameField
    })
  )

describe('inline rename in the Explorer (#523)', () => {
  const field = createElement(RenameField, {
    name: 'a.txt',
    onSubmit: () => {},
    onCancel: () => {},
    className: 'browse-rename-field'
  })

  it('the field has an accessible name and cannot be dragged', () => {
    const html = renderToStaticMarkup(field)
    expect(html).toContain('aria-label="New name"')
    expect(html).toContain('draggable="false"')
  })

  it('a tile being renamed is a plain box holding the field, not a draggable button', () => {
    const plain = tile()
    expect(plain).toContain('<button')
    expect(plain).toContain('draggable="true"')
    const renaming = tile(field)
    expect(renaming).not.toContain('<button')
    expect(renaming).not.toContain('draggable="true"')
    expect(renaming).toContain('<input')
    expect(renaming).toContain('data-browse-path="C:\\x\\a.txt"')
    expect(renaming).toContain('data-renaming="true"')
  })

  it('no rename goes through a dialog but the one for a file open full view', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('browseRename && !browseListShown')
    expect(readFileSync(new URL('./ArchiveView.tsx', import.meta.url), 'utf8')).not.toContain('BrowseRename')
  })
})