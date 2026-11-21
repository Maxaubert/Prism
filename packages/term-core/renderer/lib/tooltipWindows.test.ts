import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTooltipDocument, onTooltipDocuments, titled, tooltipDocuments } from './tooltipWindows'

// Tips in a window the host draws into (audit #95).
describe('tooltipWindows', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists this page first, then each registered window, until its undo', () => {
    const other = { nodeType: 9 } as unknown as Document
    const seen = vi.fn()
    const unwatch = onTooltipDocuments(seen)
    expect(tooltipDocuments()).toEqual([document])
    const undo = addTooltipDocument(other)
    expect(tooltipDocuments()).toEqual([document, other])
    undo()
    expect(tooltipDocuments()).toEqual([document])
    expect(seen).toHaveBeenCalledTimes(2)
    unwatch()
  })

  it('finds a titled element of another window, where instanceof Element fails', () => {
    const body = { nodeType: 1, hasAttribute: () => false, dataset: {}, parentElement: null } as unknown as HTMLElement
    const el = {
      nodeType: 1,
      hasAttribute: (n: string) => n === 'title',
      dataset: {},
      parentElement: body,
      ownerDocument: { body }
    } as unknown as HTMLElement
    Object.assign(body, { ownerDocument: { body } })
    expect(titled(el)).toBe(el)
    expect(titled(body)).toBeNull()
  })
})