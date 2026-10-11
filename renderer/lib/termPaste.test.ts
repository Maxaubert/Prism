import { describe, expect, it } from 'vitest'
import { decidePaste, imagePasteKey, newlineKey, quotePath, quotePaths, sanitizePaste } from './termPaste'

describe('decidePaste', () => {
  // Image wins: a clipboard-aware TUI (Claude Code) reads it itself off the
  // OS clipboard when it sees the ^V keystroke; our job is not to swallow it.
  it('an image forwards the ^V key', () => {
    expect(decidePaste({ image: true, text: '', files: [] })).toEqual({ kind: 'key' })
  })
  it('an image wins even when text rides along (Word copies both)', () => {
    expect(decidePaste({ image: true, text: 'x', files: [] })).toEqual({ kind: 'key' })
  })
  it('text becomes a bracketed paste', () => {
    expect(decidePaste({ image: false, text: 'a\nb', files: [] })).toEqual({ kind: 'text', data: 'a\nb' })
  })
  it('copied files paste as quoted paths, in the quoting of the shell', () => {
    expect(decidePaste({ image: false, text: '', files: ['C:\\a b\\s.png'] }, 'powershell')).toEqual({
      kind: 'text',
      data: "'C:\\a b\\s.png'"
    })
    expect(decidePaste({ image: false, text: '', files: ['C:\\a b\\s.png'] }, 'cmd')).toEqual({
      kind: 'text',
      data: '"C:\\a b\\s.png"'
    })
  })
  it('an image copied as a file pastes its path despite the document bitmap', () => {
    expect(decidePaste({ image: true, text: '', files: ['C:\\a b\\s.png'] }, 'powershell')).toEqual({
      kind: 'text',
      data: "'C:\\a b\\s.png'"
    })
  })
  it('copied files beat their own text form (Explorer sets both)', () => {
    expect(decidePaste({ image: false, text: 's.png', files: ['C:\\x\\s.png'] }, 'powershell')).toEqual({
      kind: 'text',
      data: "'C:\\x\\s.png'"
    })
  })
  it('an empty clipboard does nothing', () => {
    expect(decidePaste({ image: false, text: '', files: [] })).toEqual({ kind: 'none' })
  })
  it('text that is nothing but controls pastes nothing', () => {
    expect(decidePaste({ image: false, text: '\x1b[201~', files: [] })).toEqual({ kind: 'text', data: '[201~' })
    expect(decidePaste({ image: false, text: '\x1b\x07', files: [] })).toEqual({ kind: 'none' })
  })
})

describe('sanitizePaste (code review 2026-09-24, #1: paste injection)', () => {
  it('cannot end the bracketed paste early: every ESC and C1 CSI goes', () => {
    const attack = 'echo hi\x1b[201~rm -rf ~\r'
    const out = sanitizePaste(attack)
    expect(out).not.toContain('\x1b')
    expect(out).toBe('echo hi[201~rm -rf ~\r')
    expect(sanitizePaste('a\x9b201~b')).toBe('a201~b')
  })
  it('keeps what a paste legitimately carries: tab, newline, carriage return, and any text', () => {
    expect(sanitizePaste('a\tb\nc\r\nd ü 字 🎉')).toBe('a\tb\nc\r\nd ü 字 🎉')
  })
  it('drops the other C0 controls and DEL', () => {
    expect(sanitizePaste('a\x00b\x03c\x7fd')).toBe('abcd')
  })
})

describe('quotePath (code review 2026-09-24, #5: expansion in a dropped path)', () => {
  it('PowerShell gets single quotes, which expand nothing', () => {
    expect(quotePath('C:\\d\\report$(Start-Process calc).pdf', 'powershell')).toBe(
      "'C:\\d\\report$(Start-Process calc).pdf'"
    )
    expect(quotePath('C:\\$HOME\\x', 'powershell')).toBe("'C:\\$HOME\\x'")
  })
  it('a quote inside is doubled, the curly ones PowerShell also reads as quotes included', () => {
    expect(quotePath("C:\\Max's notes", 'powershell')).toBe("'C:\\Max''s notes'")
    expect(quotePath('C:\\Max’s notes', 'powershell')).toBe("'C:\\Max’’s notes'")
  })
  it('bash gets single quotes with its own escape for a quote', () => {
    expect(quotePath("/mnt/c/it's", 'bash')).toBe("'/mnt/c/it'\\''s'")
  })
  it('cmd, and a caller that names no shell, keep the double quotes', () => {
    expect(quotePath('C:\\a b', 'cmd')).toBe('"C:\\a b"')
    expect(quotePath('C:\\a b')).toBe('"C:\\a b"')
  })
})

describe('quotePaths', () => {
  it('quotes each and joins with spaces', () => {
    expect(quotePaths(['C:\\a.png', 'C:\\b c.png'], 'powershell')).toBe("'C:\\a.png' 'C:\\b c.png'")
    expect(quotePaths(['C:\\a.png'])).toBe('"C:\\a.png"')
  })
})

describe('imagePasteKey (#170)', () => {
  // Claude 2.1.296 on Windows binds image paste to alt+v, not ctrl+v (read in
  // its binary: `Me=Ie?"alt+v":"ctrl+v"`), so Ctrl+V's ^V did nothing there.
  it('is Alt+V (ESC v) for Claude', () => {
    expect(imagePasteKey('claude')).toBe('\x1bv')
  })
  it('is ^V for Codex, another agent and a plain shell', () => {
    expect(imagePasteKey('codex')).toBe('\x16')
    expect(imagePasteKey('other')).toBe('\x16')
    expect(imagePasteKey(null)).toBe('\x16')
  })
  it('is ONE key, never both: two would paste the image twice where both are bound', () => {
    expect(imagePasteKey('claude')).not.toContain('\x16')
  })
})

describe('newlineKey (#175, measured 2026-10-11)', () => {
  it('is Ctrl+J for Claude, its own chat:newline binding', () => {
    expect(newlineKey('claude')).toBe('\n')
  })
  it('is backslash + Enter for Codex (it drops a bare LF) and for anything else', () => {
    expect(newlineKey('codex')).toBe('\\\r')
    expect(newlineKey('other')).toBe('\\\r')
    expect(newlineKey(null)).toBe('\\\r')
  })
})