import { describe, expect, it } from 'vitest'
import {
  DONUT_COLOURS,
  DONUT_REST,
  donutBytes,
  donutSlices,
  folderRing,
  sharePercent,
  usedFraction
} from './donut'

const GB = 1024 ** 3
const TB = 1024 ** 4
const folder = (name: string, bytes: number): { name: string; path: string; bytes: number } => ({
  name,
  path: `C:\\${name}`,
  bytes
})

describe('donutSlices', () => {
  it('gives the seven biggest the palette in order and the rest the text grey', () => {
    const folders = Array.from({ length: 9 }, (_, i) => folder(`f${i}`, (9 - i) * GB))
    const slices = donutSlices(folders, 100 * GB)
    expect(slices.slice(0, 7).map((s) => s.color)).toEqual([...DONUT_COLOURS])
    expect(slices[0].color).toBe('var(--p-accent)')
    expect(slices[6].color).toBe('var(--p-kind-folder)')
    expect(slices[7].color).toBe(DONUT_REST)
    expect(slices[8].color).toBe('var(--p-kind-text)')
  })

  it('measures each slice against the whole drive and starts it where the last ended', () => {
    const slices = donutSlices([folder('a', 50), folder('b', 30), folder('c', 10)], 200)
    expect(slices.map((s) => s.fraction)).toEqual([0.25, 0.15, 0.05])
    expect(slices.map((s) => s.offset)).toEqual([0, 0.25, 0.4])
  })

  it('keeps a sliver under 0.15% in the list but does not draw it, and keeps its place', () => {
    const slices = donutSlices([folder('big', 500), folder('tiny', 1), folder('next', 100)], 1000)
    expect(slices.map((s) => s.drawn)).toEqual([true, false, true])
    expect(slices[2].offset).toBeCloseTo(0.501)
    // 0.15% exactly is drawn.
    expect(donutSlices([folder('edge', 15)], 10000)[0].drawn).toBe(true)
    expect(donutSlices([folder('empty', 0)], 10000)[0].drawn).toBe(false)
  })

  it('never runs past a full turn when the index over-counts', () => {
    const slices = donutSlices([folder('a', 80), folder('b', 40)], 100)
    expect(slices[0].fraction).toBe(0.8)
    expect(slices[1].fraction).toBeCloseTo(0.2)
  })

  it('draws nothing without a total', () => {
    const slices = donutSlices([folder('a', 80)], undefined)
    expect(slices[0]).toMatchObject({ fraction: 0, drawn: false, path: 'C:\\a' })
  })
})

describe('usedFraction', () => {
  it('is used over total, clamped, and 0 when unknown', () => {
    expect(usedFraction(200, 50)).toBe(0.75)
    expect(usedFraction(200, 300)).toBe(0)
    expect(usedFraction(undefined, 50)).toBe(0)
    expect(usedFraction(200, undefined)).toBe(0)
  })
})

describe('sharePercent', () => {
  it('rounds, shows <1% for a sliver and nothing for nothing', () => {
    expect(sharePercent(34, 100)).toBe('34%')
    expect(sharePercent(1, 1000)).toBe('<1%')
    expect(sharePercent(0, 1000)).toBe('')
    expect(sharePercent(5, undefined)).toBe('')
  })
})

describe('donutBytes', () => {
  it('reads sizes the way the mockup does', () => {
    expect(donutBytes(3910324973568)).toBe('3.56 TB')
    expect(donutBytes(3910324973568 + 4089843286016)).toBe('7.28 TB')
    expect(donutBytes(2 * TB)).toBe('2 TB')
    expect(donutBytes(215917679005)).toBe('201 GB')
    expect(donutBytes(61548199906)).toBe('57.3 GB')
    expect(donutBytes(5 * GB)).toBe('5 GB')
    expect(donutBytes(49309982)).toBe('47 MB')
    expect(donutBytes(4096)).toBe('4 KB')
    expect(donutBytes(100)).toBe('1 KB')
    expect(donutBytes(0)).toBe('Empty')
  })
})

describe('folderRing', () => {
  const folders = [
    { name: 'Admin', path: 'C:\\Users\\Admin', bytes: 700 * GB },
    { name: 'Public', path: 'C:\\Users\\Public', bytes: 200 * GB }
  ]
  it('is the folder whole: its folders, then its own files last and grey', () => {
    const ring = folderRing({ bytes: 1000 * GB, files: 100 * GB, folders }, 'Users')
    expect(ring.map((s) => s.name)).toEqual(['Admin', 'Public', 'Files in Users'])
    expect(ring.map((s) => s.fraction)).toEqual([0.7, 0.2, 0.1])
    expect(ring[2]).toMatchObject({ files: true, color: DONUT_REST })
    expect(ring[0].color).toBe(DONUT_COLOURS[0])
  })
  it('has no files row when nothing sits in it directly', () => {
    expect(folderRing({ bytes: 900 * GB, files: 0, folders }, 'Users').some((s) => s.files)).toBe(false)
  })
  it('a folder with no folders is one grey slice, the whole ring', () => {
    const ring = folderRing({ bytes: 4 * GB, files: 4 * GB, folders: [] }, 'Clips')
    expect(ring).toHaveLength(1)
    expect(ring[0]).toMatchObject({ name: 'Files in Clips', fraction: 1, files: true })
  })
})