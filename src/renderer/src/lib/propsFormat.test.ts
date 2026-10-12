import { describe, expect, it } from 'vitest'
import { langColour, TEXT_COLOUR } from './langColour'
import {
  audioFormat,
  bitrateLabel,
  count,
  dateFacts,
  encodingLabel,
  eolLabel,
  fpsLabel,
  languageName,
  megapixels,
  headerParent,
  resolutionLabel,
  shortHash,
  subtitlesLabel,
  textCounts,
  trackLabel,
  trackName,
  videoLabel,
  whenLabel
} from './propsFormat'

// The Properties window's wording, as the approved mockups wrote it
// (owner, 2026-10-12, research/prism/mockups/2026-10-12-properties/final).

describe('the picture', () => {
  it('names the resolution by its short side', () => {
    expect(resolutionLabel(3840, 2160)).toBe('3840 × 2160 (4K)')
    expect(resolutionLabel(4096, 2160)).toBe('4096 × 2160 (4K)')
    expect(resolutionLabel(1920, 1080)).toBe('1920 × 1080 (1080p)')
    expect(resolutionLabel(1080, 1920)).toBe('1080 × 1920 (1080p)')
    expect(resolutionLabel(1280, 720)).toBe('1280 × 720 (720p)')
    expect(resolutionLabel(640, 480)).toBe('640 × 480')
  })

  it('says the frame rate and the codec line', () => {
    expect(fpsLabel(60)).toBe('60 fps')
    expect(fpsLabel(30000 / 1001)).toBe('29.97 fps')
    expect(fpsLabel(24000 / 1001)).toBe('23.976 fps')
    expect(videoLabel({ width: 1, height: 1, codec: 'H.264', profile: 'High', bitDepth: 8 })).toBe('H.264 (High), 8-bit')
    expect(videoLabel({ width: 1, height: 1, codec: 'HEVC (H.265)', profile: 'Main 10', bitDepth: 10, hdr: 'HDR10' })).toBe(
      'HEVC (H.265), Main 10, 10-bit, HDR10'
    )
    expect(videoLabel({ width: 1, height: 1, codec: 'AV1' })).toBe('AV1')
  })

  it('gives megapixels to one decimal', () => {
    expect(megapixels(1448, 1086)).toBe('1.6 MP')
  })
})

describe('the sound', () => {
  it('words a film bitrate in Mb/s and a song in kb/s', () => {
    expect(bitrateLabel(32_000_000, 'video')).toBe('32.0 Mb/s')
    expect(bitrateLabel(871_000, 'audio')).toBe('871 kb/s')
    expect(bitrateLabel(3_104_000, 'audio')).toBe('3,104 kb/s')
    expect(bitrateLabel(500_000, 'video')).toBe('500 kb/s')
  })

  it('words a song format and a film track', () => {
    expect(audioFormat({ codec: 'FLAC', bitDepth: 16, sampleRate: 44100, layout: 'stereo' })).toBe(
      'FLAC, 16-bit, 44.1 kHz, stereo'
    )
    expect(trackLabel({ codec: 'AAC', sampleRate: 48000, channels: 2, bitDepth: 16 })).toBe('AAC, 48 kHz, stereo')
    expect(trackLabel({ codec: 'AC-3', channels: 6 })).toBe('AC-3, 6 channels')
  })

  it('names tracks by language, else title, else number', () => {
    expect(languageName('eng')).toBe('English')
    expect(languageName('nor')).toBe('Norwegian')
    expect(languageName('und')).toBe('')
    expect(trackName({ language: 'jpn' }, 0)).toBe('Japanese')
    expect(trackName({ title: 'Commentary' }, 1)).toBe('Commentary')
    expect(trackName({}, 2)).toBe('Track 3')
    expect(subtitlesLabel([])).toBe('None')
    expect(subtitlesLabel([{ language: 'eng' }, { language: 'fre' }])).toBe('English, French')
  })
})

describe('the text', () => {
  it('words the encoding and the line endings', () => {
    expect(encodingLabel({ encoding: 'UTF-8', bom: false, eol: 'LF' })).toBe('UTF-8, no BOM')
    expect(encodingLabel({ encoding: 'UTF-8', bom: true, eol: 'LF' })).toBe('UTF-8, with BOM')
    expect(encodingLabel({ encoding: 'UTF-16 LE', bom: true, eol: 'CRLF' })).toBe('UTF-16 LE')
    expect(eolLabel('LF')).toBe('LF (Unix)')
    expect(eolLabel('CRLF')).toBe('CRLF (Windows)')
    expect(eolLabel('CR')).toBe('CR (classic Mac)')
    expect(eolLabel('Mixed')).toBe('Mixed')
  })

  it('counts lines the way an editor does', () => {
    expect(textCounts('')).toEqual({ lines: 0, words: 0, chars: 0 })
    expect(textCounts('one two\nthree\n')).toEqual({ lines: 2, words: 3, chars: 14 })
    expect(textCounts('a\r\nb\r\nc')).toEqual({ lines: 3, words: 3, chars: 7 })
    expect(count(1234567)).toBe('1,234,567')
  })

  it('colours a language it knows, and plain text in the text colour', () => {
    expect(langColour('Python')).toBe('#6fb2ff')
    expect(langColour('COBOL')).toBe(TEXT_COLOUR)
    expect(langColour(undefined)).toBe(TEXT_COLOUR)
  })
})

describe('the rest', () => {
  it('shortens a hash in the middle: the first 16 and the last 12', () => {
    const hex = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    expect(shortHash(hex)).toBe('9f86d081884c7d65…6c15b0f00a08')
    expect(shortHash('abc')).toBe('abc')
  })

  it('writes dates with a comma before the time, and leaves out the unknown', () => {
    const ms = new Date(2026, 9, 9, 21, 14).getTime()
    expect(whenLabel(ms)).toBe('9 Oct 2026, 21:14')
    expect(whenLabel(undefined)).toBe('')
    expect(dateFacts({ mtimeMs: ms, birthtimeMs: ms }).map((r) => r.label)).toEqual(['Created', 'Modified'])
    expect(dateFacts(null)).toEqual([])
  })

  it('finds the folder a file sits in', () => {
    expect(headerParent('C:\\Users\\Admin\\a.txt')).toBe('C:\\Users\\Admin')
    expect(headerParent('C:\\a.txt')).toBe('C:\\')
  })
})
