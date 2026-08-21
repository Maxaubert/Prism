import { describe, expect, it } from 'vitest'
import { unsupportedMessage } from './unsupported'

const GENERIC = "Prism can't show this kind of file"

describe('unsupportedMessage', () => {
  it('names an ordinary extension', () => {
    expect(unsupportedMessage('.zip')).toBe("Prism can't show ZIP files")
    expect(unsupportedMessage('.docx')).toBe("Prism can't show DOCX files")
  })
  it('takes the extension with or without its dot', () => {
    expect(unsupportedMessage('exe')).toBe("Prism can't show EXE files")
  })
  it('falls back when there is no extension to name', () => {
    expect(unsupportedMessage('')).toBe(GENERIC)
    expect(unsupportedMessage('.')).toBe(GENERIC)
  })
  it('falls back rather than shout a sentence', () => {
    // `extname` of "notes.final version" is the whole tail, not an extension.
    expect(unsupportedMessage('.final version')).toBe(GENERIC)
    expect(unsupportedMessage('.superlongextension')).toBe(GENERIC)
  })
  it('falls back on anything that is not plain alphanumerics', () => {
    expect(unsupportedMessage('.a-b')).toBe(GENERIC)
    expect(unsupportedMessage('.tar.gz')).toBe(GENERIC)
  })
})
