import { join, sep } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addRoot, dropRoot, insideAnyRoot, isAnyRoot, openRoots, resetRoots, validRoot } from './roots'

const A = join('C:', 'shoot')
const B = join('D:', 'docs')

beforeEach(() => resetRoots())

describe('the open-root set', () => {
  it('starts empty, and an empty set lets nothing through', () => {
    expect(openRoots()).toEqual([])
    expect(insideAnyRoot(join(A, 'a.jpg'))).toBe(false)
    expect(isAnyRoot(A)).toBe(false)
  })
  it('keeps roots in the order they were opened, without duplicates', () => {
    addRoot(A)
    addRoot(B)
    addRoot(A)
    expect(openRoots()).toEqual([A, B])
  })
  it('treats a root that differs only in case or trailing separator as the same', () => {
    addRoot(A)
    addRoot(A.toUpperCase())
    addRoot(A + sep)
    expect(openRoots()).toHaveLength(1)
  })
  it('drops a root, and with it everything under it', () => {
    addRoot(A)
    addRoot(B)
    dropRoot(A)
    expect(openRoots()).toEqual([B])
    expect(insideAnyRoot(join(A, 'a.jpg'))).toBe(false)
    expect(insideAnyRoot(join(B, 'a.md'))).toBe(true)
  })
})

describe('insideAnyRoot', () => {
  it('accepts a path under any open root', () => {
    addRoot(A)
    addRoot(B)
    expect(insideAnyRoot(join(A, 'sub', 'deep.mp4'))).toBe(true)
    expect(insideAnyRoot(join(B, 'a.md'))).toBe(true)
  })
  it('refuses a path under no open root', () => {
    addRoot(A)
    expect(insideAnyRoot(join('C:', 'elsewhere', 'x.jpg'))).toBe(false)
  })
  it('refuses a traversal out of every root', () => {
    addRoot(A)
    expect(insideAnyRoot(join(A, 'sub', '..', '..', 'elsewhere'))).toBe(false)
  })
  it('refuses a sibling whose name merely starts the same', () => {
    addRoot(A)
    expect(insideAnyRoot(`${A}-old`)).toBe(false)
    expect(insideAnyRoot(join(`${A}-old`, 'x.jpg'))).toBe(false)
  })
})

describe('isAnyRoot', () => {
  it('names each open root itself, which nothing may rename or bin', () => {
    addRoot(A)
    addRoot(B)
    expect(isAnyRoot(A)).toBe(true)
    expect(isAnyRoot(B)).toBe(true)
    expect(isAnyRoot(join(A, 'sub'))).toBe(false)
  })
})

describe('validRoot', () => {
  it('accepts a path inside the root that was named, when that root is open', () => {
    addRoot(A)
    addRoot(B)
    expect(validRoot(A, join(A, 'a.jpg'))).toBe(true)
  })
  it('refuses a root that is not open, even for a path inside it', () => {
    addRoot(A)
    expect(validRoot(B, join(B, 'a.md'))).toBe(false)
  })
  it('refuses a path from ANOTHER open root: this is the per-tab check', () => {
    addRoot(A)
    addRoot(B)
    expect(validRoot(A, join(B, 'a.md'))).toBe(false)
  })
})
