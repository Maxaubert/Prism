import { describe, expect, it } from 'vitest'
import { OSC52_MAX, parseOsc52 } from './termOsc52'

// OSC 52 IS WRITE-ONLY (#176): a program may put text ON the clipboard, never
// read it. Everything else is refused (null), and a read is named so the
// handler can swallow it without an answer.

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

describe('parseOsc52', () => {
  it('decodes a "c" write', () => {
    expect(parseOsc52('c;aGVsbG8=', OSC52_MAX)).toEqual({ kind: 'write', text: 'hello' })
  })
  it('takes an empty selection as the clipboard', () => {
    expect(parseOsc52(';aGVsbG8=', OSC52_MAX)).toEqual({ kind: 'write', text: 'hello' })
  })
  it('refuses the primary selection and any list of selections', () => {
    expect(parseOsc52('p;aGVsbG8=', OSC52_MAX)).toBeNull()
    expect(parseOsc52('cs;aGVsbG8=', OSC52_MAX)).toBeNull()
    expect(parseOsc52('s0;aGVsbG8=', OSC52_MAX)).toBeNull()
  })
  it('names a read, so it is swallowed and never answered', () => {
    expect(parseOsc52('c;?', OSC52_MAX)).toEqual({ kind: 'read' })
    expect(parseOsc52(';?', OSC52_MAX)).toEqual({ kind: 'read' })
  })
  it('ignores a clear (empty data) and a sequence with no data part', () => {
    expect(parseOsc52('c;', OSC52_MAX)).toBeNull()
    expect(parseOsc52('c', OSC52_MAX)).toBeNull()
  })
  it('refuses what is not base64', () => {
    expect(parseOsc52('c;not base64!', OSC52_MAX)).toBeNull()
    expect(parseOsc52('c;aGVsbG8', OSC52_MAX)).toBeNull() // a length that is not a multiple of 4
    expect(parseOsc52('c;a=GV', OSC52_MAX)).toBeNull()
  })
  it('refuses invalid UTF-8', () => {
    expect(parseOsc52(`c;${Buffer.from([0xff, 0xfe, 0x41]).toString('base64')}`, OSC52_MAX)).toBeNull()
  })
  it('round-trips UTF-8', () => {
    expect(parseOsc52(`c;${b64('æøå OSC52 æ')}`, OSC52_MAX)).toEqual({ kind: 'write', text: 'æøå OSC52 æ' })
  })
  it('refuses one character over the cap, takes the cap itself', () => {
    expect(parseOsc52(`c;${b64('x'.repeat(10))}`, 10)).toEqual({ kind: 'write', text: 'x'.repeat(10) })
    expect(parseOsc52(`c;${b64('x'.repeat(11))}`, 10)).toBeNull()
  })
  it('refuses an encoded length far past the cap without decoding it', () => {
    expect(parseOsc52(`c;${'A'.repeat(4 * 1000)}`, 10)).toBeNull()
  })
  it('caps at 1 MB of text', () => {
    expect(OSC52_MAX).toBe(1_048_576)
  })
})
