import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BIN_PLACE } from '@shared/binPlace'
import type { DirListing } from '@shared/types'
import { grantDesktopDirectory, releaseDesktop, resetDesktopAccess } from './desktopAccess'
import { createExplorerListings } from './explorerListing'
import type { ListingCache } from './listingCache'

beforeEach(() => resetDesktopAccess())
afterEach(() => resetDesktopAccess())

const listing: DirListing = { folders: [], files: [], bin: true }

function make(bin?: () => Promise<DirListing>) {
  const put = vi.fn()
  const drop = vi.fn()
  const cache = { put, drop, generation: 0 } as unknown as ListingCache
  const lists = createExplorerListings({ cache, send: () => {}, localFixed: () => true, bin })
  return { lists, put, drop }
}

describe('the bin hook of the Explorer listing (D5)', () => {
  it('answers the sentinel with the bin listing and never writes the listing cache', async () => {
    const { lists, put } = make(async () => listing)
    const got = await lists.browse('tab', BIN_PLACE)
    expect(got).toEqual({ path: BIN_PLACE, listing })
    expect(put).not.toHaveBeenCalled()
  })

  it('answers a closed tab nothing', async () => {
    const { lists } = make(async () => listing)
    releaseDesktop('gone')
    expect(await lists.browse('gone', BIN_PLACE)).toBeNull()
  })

  it('is never cached on disk or read ahead', async () => {
    const { lists } = make(async () => listing)
    expect(lists.cached(BIN_PLACE)).toBeNull()
    expect(await lists.cachedAsync(BIN_PLACE)).toBeNull()
    expect(await lists.prefetch(BIN_PLACE)).toBeNull()
  })

  it('without a bin reader the sentinel is just not a folder', async () => {
    const { lists } = make()
    expect(await lists.browse('tab', BIN_PLACE)).toBeNull()
  })

  it('a read of an ordinary folder is untouched by the hook', async () => {
    const box = mkdtempSync(join(tmpdir(), 'prism-el-'))
    try {
      mkdirSync(join(box, 'sub'))
      writeFileSync(join(box, 'a.txt'), 'x')
      const { lists } = make(async () => listing)
      grantDesktopDirectory('tab', box)
      const got = await lists.browse('tab', box, false)
      expect(got?.listing.bin).toBeUndefined()
      expect(got?.listing.files.map((f) => f.name)).toEqual(['a.txt'])
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  })
})
