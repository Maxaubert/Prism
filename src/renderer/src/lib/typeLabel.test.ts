import { describe, expect, it } from 'vitest'
import { typeLabel } from './typeLabel'

describe('typeLabel', () => {
  it('names the format and what Prism will do with it', () => {
    expect(typeLabel('IMG_1837.HEIC', false)).toBe('HEIC image')
    expect(typeLabel('clip.mkv', false)).toBe('MKV video')
    expect(typeLabel('song.flac', false)).toBe('FLAC audio')
    expect(typeLabel('manual.pdf', false)).toBe('PDF document')
    expect(typeLabel('inner.zip', false)).toBe('ZIP archive')
  })

  it('calls source source, and prose text', () => {
    // Both are kind 'text'; only one of them is a language.
    expect(typeLabel('app.ts', false)).toBe('TypeScript source')
    expect(typeLabel('notes.txt', false)).toBe('TXT text')
    expect(typeLabel('subs.srt', false)).toBe('SRT text')
  })

  it('spells out the names an extension abbreviates', () => {
    expect(typeLabel('photo.jpg', false)).toBe('JPEG image')
    expect(typeLabel('README.md', false)).toBe('Markdown document')
  })

  it('has an answer for a folder and for a name with no extension', () => {
    expect(typeLabel('docs', true)).toBe('Folder')
    expect(typeLabel('LICENSE', false)).toBe('File')
  })

  it('falls back to the extension for something Prism cannot show', () => {
    expect(typeLabel('setup.exe', false)).toBe('EXE file')
  })
})
