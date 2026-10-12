import { describe, expect, it } from 'vitest'
import { ROW_GAP, ROW_ICON, ROW_PAD_X, TREE_SIZES, rowLook } from './treePrefs'

// One file row for the tree and the Explorer's list (#257): the Explorer reads
// the same height and text size the tree's size setting gives the tree.
describe('rowLook', () => {
  it('is the tree size for every size, with the shared icon, gap and padding', () => {
    for (const size of TREE_SIZES)
      expect(rowLook(size)).toEqual({
        height: size.row,
        font: size.font,
        icon: ROW_ICON,
        gap: ROW_GAP,
        padX: ROW_PAD_X
      })
  })
  it('the default row is the 26px, 12.5px row the tree has always drawn', () => {
    const d = rowLook(TREE_SIZES.find((s) => s.id === 'default')!)
    expect([d.height, d.font, d.icon]).toEqual([26, 12.5, 14])
  })
})
