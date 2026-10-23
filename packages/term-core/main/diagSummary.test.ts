import { describe, expect, it } from 'vitest'
import { capString, cleanFields, errorFields, STACK_MAX, STRING_MAX, summariseArgs, summariseValue } from './diagSummary'

describe('capString', () => {
  it('leaves a short string alone and cuts a long one at the cap, saying so', () => {
    expect(capString('abc')).toBe('abc')
    const long = 'x'.repeat(STRING_MAX + 50)
    const cut = capString(long)
    expect(cut.length).toBeLessThanOrEqual(STRING_MAX + 12)
    expect(cut.endsWith('(+50)')).toBe(true)
  })
})

describe('summariseValue', () => {
  it('keeps primitives, caps strings, and logs an array as its length', () => {
    expect(summariseValue(5)).toBe(5)
    expect(summariseValue(true)).toBe(true)
    expect(summariseValue(null)).toBe(null)
    expect(summariseValue(undefined)).toBe(null)
    expect(summariseValue([1, 2, 3])).toBe('[3]')
    expect(summariseValue('y'.repeat(400))).toMatch(/\(\+100\)$/)
  })
  it('logs bytes by size, never by content', () => {
    expect(summariseValue(new Uint8Array(1234))).toBe('bytes:1234')
  })
  it('flattens an object one level, deeper ones as their key count', () => {
    expect(summariseValue({ a: 'x', b: [1, 2], c: { d: 1, e: 2 } })).toEqual({ a: 'x', b: '[2]', c: '{2}' })
  })
  it('stops at twelve keys', () => {
    const big = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(summariseValue(big) as object)).toHaveLength(12)
  })
})

describe('summariseArgs', () => {
  it('summarises the first four arguments', () => {
    expect(summariseArgs(['C:\\a', 2, [1], { x: 1 }, 'dropped'])).toEqual(['C:\\a', 2, '[1]', { x: 1 }])
  })
  it('logs an opaque channel argument as its kind and size alone', () => {
    // Typed text and the clipboard are what somebody would not want written down.
    expect(summariseArgs(['id-1', 'secret typed text'], true)).toEqual(['string:4', 'string:17'])
  })
})

describe('errorFields', () => {
  it('takes the message and a longer stack from an Error', () => {
    const e = new Error('nope')
    const f = errorFields(e)
    expect(f.msg).toBe('nope')
    expect(typeof f.stack).toBe('string')
  })
  it('reads anything thrown, a string or a plain object', () => {
    expect(errorFields('bad')).toEqual({ msg: 'bad' })
    expect(errorFields({ message: 'obj' }).msg).toBe('obj')
    expect(errorFields(undefined).msg).toBe('undefined')
  })
  it('caps a stack at its own, longer cap', () => {
    const e = new Error('x')
    e.stack = 's'.repeat(STACK_MAX * 2)
    expect(errorFields(e).stack!.length).toBeLessThanOrEqual(STACK_MAX + 12)
  })
})

describe('cleanFields', () => {
  it('caps strings, keeps small lists of records, and drops what JSON cannot say', () => {
    const out = cleanFields({
      s: 'z'.repeat(400),
      stack: 'q'.repeat(1000),
      scripts: [{ src: 'a', ms: 1 }],
      n: Number.NaN,
      f: () => 1
    })
    expect((out.s as string).length).toBeLessThan(330)
    expect((out.stack as string).length).toBe(1000)
    expect(out.scripts).toEqual([{ src: 'a', ms: 1 }])
    expect(out.n).toBe(null)
    expect('f' in out).toBe(false)
  })
  it('keeps at most ten items of a list', () => {
    expect((cleanFields({ l: Array.from({ length: 30 }, (_, i) => i) }).l as unknown[]).length).toBe(10)
  })
})
