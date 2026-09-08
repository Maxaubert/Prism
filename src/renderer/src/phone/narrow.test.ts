import { describe, expect, it } from 'vitest'
import type { SearchHit } from '@shared/types'
import { narrowHits } from './narrow'

const hit = (name: string, isFolder = false): SearchHit => ({
  path: `C:\\root\\${name}`,
  name,
  kind: 'video',
  dir: '',
  ...(isFolder ? { isFolder: true } : {})
})

const answer = (q: string, ...names: string[]): { q: string; hits: SearchHit[] } => ({
  q,
  hits: names.map((n) => hit(n))
})

describe('what the phone draws while the PC is still walking', () => {
  it('has nothing to show before the first answer', () => {
    expect(narrowHits(null, 'ep')).toBeNull()
    expect(narrowHits(answer('ep', 'ep1.mp4'), '')).toBeNull()
  })

  it('narrows the last answer with the same matcher the server uses', () => {
    const prev = answer('ep', 'ep1.mp4', 'ep2.mp4', 'trailer.mp4')
    expect(narrowHits(prev, 'ep1')?.map((h) => h.name)).toEqual(['ep1.mp4'])
  })

  it('reads the desktop grammar, because it is the desktop parser', () => {
    const prev = answer('ep', 'ep1.mp4', 'ep2.mkv', 'ep3.mp4')
    expect(narrowHits(prev, 'ep ext:mp4')?.map((h) => h.name)).toEqual(['ep1.mp4', 'ep3.mp4'])
    expect(narrowHits(prev, 'ep -mkv')?.map((h) => h.name)).toEqual(['ep1.mp4', 'ep3.mp4'])
  })

  it('narrows a folder hit by its name, exactly as the walk matched it', () => {
    const prev = { q: 'sea', hits: [hit('season1', true), hit('seagull.jpg')] }
    expect(narrowHits(prev, 'season')?.map((h) => h.name)).toEqual(['season1'])
  })

  it('keeps the rows as they are when the query did not grow', () => {
    // A shorter query can only ever WIDEN the answer, and a widening is not
    // something a page holding 200 rows can compute. So the rows stay put
    // until the PC says otherwise, rather than blinking out.
    const prev = answer('ep1', 'ep1.mp4')
    expect(narrowHits(prev, 'ep')?.map((h) => h.name)).toEqual(['ep1.mp4'])
    expect(narrowHits(prev, 'trailer')?.map((h) => h.name)).toEqual(['ep1.mp4'])
  })

  it('keeps them when the narrowing empties the list', () => {
    // Growth does not always narrow: `*.mp` to `*.mp4` matches a different
    // set entirely, and so does `ext:mp` to `ext:mp4`. An empty guess is
    // still a guess, so the answer on screen stays until the real one lands.
    const prev = answer('*.mp', 'take.mp')
    expect(narrowHits(prev, '*.mp4')?.map((h) => h.name)).toEqual(['take.mp'])
    expect(narrowHits(answer('ep', 'ep1.mp4'), 'ep9')?.map((h) => h.name)).toEqual(['ep1.mp4'])
  })

  it('is the same rows, not copies, when nothing is narrowed', () => {
    // React keys these by path, so returning fresh objects would be a render
    // of the whole list for no change at all.
    const prev = answer('ep', 'ep1.mp4')
    expect(narrowHits(prev, 'ep')).toBe(prev.hits)
  })
})
