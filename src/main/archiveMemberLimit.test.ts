import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'zlib'
import { MEMBER_MAX_BYTES, memberData } from './archive'
import type { ZipEntryLike } from './zipShared'

// Audit #25 (owner, 2026-11-20): a member that declares size 0 but carries
// data, or declares more than the hard cap, is refused, never inflated unbounded.

function entry(size: number, packed: Buffer, crc = 0): ZipEntryLike {
  return {
    header: { flags: 0, method: 8, size, crc },
    getCompressedData: () => packed,
    getData: () => Buffer.alloc(0)
  } as unknown as ZipEntryLike
}

describe('memberData limits', () => {
  it('refuses a member that declares size 0 but carries a large inflate', async () => {
    const bomb = deflateRawSync(Buffer.alloc(64 * 1024 * 1024))
    await expect(memberData(entry(0, bomb))).rejects.toThrow(/size 0/)
  })

  it('refuses a member that declares more than the hard cap', async () => {
    await expect(memberData(entry(MEMBER_MAX_BYTES + 1, deflateRawSync(Buffer.from('x'))))).rejects.toThrow(/too large/)
  })

  it('still reads an honest member and a truly empty one', async () => {
    const body = Buffer.from('hello world')
    const { crc32 } = await import('zlib')
    const crc = (crc32 as (b: Buffer) => number)(body)
    expect((await memberData(entry(body.length, deflateRawSync(body), crc))).toString()).toBe('hello world')
    expect((await memberData(entry(0, deflateRawSync(Buffer.alloc(0))))).length).toBe(0)
  })
})