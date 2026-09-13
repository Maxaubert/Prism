import { describe, expect, it } from 'vitest'
import { memoryPatch } from './memory'

describe('memoryPatch', () => {
  it('takes the four fields, null to clear, and refuses anything else', () => {
    expect(memoryPatch({ t: 12, audio: 2, subs: 'C:\\a.srt', fit: '16:9' })).toEqual({
      t: 12,
      audio: 2,
      subs: 'C:\\a.srt',
      fit: '16:9'
    })
    expect(memoryPatch({ t: null, audio: null, subs: null, fit: null })).toEqual({
      t: null,
      audio: null,
      subs: null,
      fit: null
    })
    expect(memoryPatch({ t: 'x' })).toBeNull()
    expect(memoryPatch({ audio: 1.5 })).toBeNull()
    expect(memoryPatch({ fit: 'not a fit!' })).toBeNull()
    expect(memoryPatch({ other: 1 })).toBeNull()
    expect(memoryPatch(null)).toBeNull()
  })
})
