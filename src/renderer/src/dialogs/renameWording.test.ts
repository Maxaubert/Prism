import { describe, expect, it } from 'vitest'
import { NEW_FOLDER_WORDS, RENAME_WORDS } from './renameWording'

describe('the name dialog words', () => {
  it('F2 says Rename, Ctrl+Shift+N says New folder, Name and Done', () => {
    expect(RENAME_WORDS).toEqual({ title: 'Rename', label: 'New name', done: 'Rename' })
    expect(NEW_FOLDER_WORDS).toEqual({ title: 'New folder', label: 'Name', done: 'Done' })
  })
})
