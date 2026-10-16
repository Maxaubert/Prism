import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A SEARCH DOES NOT RESTART ON FOCUS (review, 2026-10-16). Read as source,
// the way noFocusRings.test.ts reads the renderer: the hook's `revision` is
// bumped by the window's focus and by the folder's watcher, and handing it to
// useBrowseSearch made a new search key each time, which blanked the results,
// reset the window to the top and restarted the walk. Only `refreshKey` (F5,
// a file operation) may re-run a search. (The hook's effects need a live
// window and IPC, which the node test environment does not have.)
const src = readFileSync(resolve(__dirname, 'useFolderBrowsing.ts'), 'utf8').replace(/\r\n/g, '\n')

describe('the Explorer search key', () => {
  const call = src.match(/useBrowseSearch\(([\s\S]*?)\n {2}\)/)?.[1] ?? ''
  const args = call
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .join(' ')

  it('found the call', () => {
    expect(args).toContain('refreshKey')
  })

  it('leaves the focus and watcher revision out', () => {
    expect(args).not.toMatch(/\brevision\b/)
  })
})
