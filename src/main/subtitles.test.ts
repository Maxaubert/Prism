import { describe, expect, it } from 'vitest'
import { matchSubs, srtToVtt, stripVttStyles } from './subtitles'

describe('matchSubs', () => {
  const files = [
    'S01E23.mkv',
    'S01E23.srt',
    'S01E23.en.srt',
    'S01E23.de.srt',
    'S01E23.en.forced.srt',
    'S01E23.vtt',
    'S01E24.srt',
    'S01E23.jpg',
    'notes.txt'
  ]

  it('finds the exact-stem sidecars', () => {
    const m = matchSubs('S01E23.mkv', files)
    expect(m.map((x) => x.name)).toContain('S01E23.srt')
    expect(m.map((x) => x.name)).toContain('S01E23.vtt')
  })

  it('labels language suffixes with the language name', () => {
    const m = matchSubs('S01E23.mkv', files)
    expect(m.find((x) => x.name === 'S01E23.en.srt')?.label).toBe('English')
    expect(m.find((x) => x.name === 'S01E23.de.srt')?.label).toBe('German')
  })

  it('keeps extra qualifiers without losing the language', () => {
    const m = matchSubs('S01E23.mkv', files)
    expect(m.find((x) => x.name === 'S01E23.en.forced.srt')?.label).toBe('English')
  })

  it('never matches another episode or a non-subtitle', () => {
    const names = matchSubs('S01E23.mkv', files).map((x) => x.name)
    expect(names).not.toContain('S01E24.srt')
    expect(names).not.toContain('S01E23.jpg')
    expect(names).not.toContain('notes.txt')
  })

  it('matches case-insensitively, the Windows way', () => {
    expect(matchSubs('Movie.MP4', ['movie.SRT'])).toHaveLength(1)
  })

  it('does not treat a longer stem as a qualifier match', () => {
    // "Movie 2.srt" must not attach to "Movie.mp4".
    expect(matchSubs('Movie.mp4', ['Movie 2.srt'])).toHaveLength(0)
  })
})

describe('srtToVtt', () => {
  it('converts timestamps and prepends the header', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond cue\n'
    const vtt = srtToVtt(srt)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.500')
    expect(vtt).toContain('00:00:03.000 --> 00:00:04.000')
    expect(vtt).toContain('Hello there')
  })

  it('normalises CRLF and strips a BOM', () => {
    const vtt = srtToVtt('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n')
    expect(vtt).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHi\n')
  })

  it('leaves styling tags and commas in cue text alone', () => {
    const vtt = srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n<i>Well, well</i>\n')
    expect(vtt).toContain('<i>Well, well</i>')
  })
})

describe('stripVttStyles', () => {
  it('drops a STYLE block that could reach the network, keeps the cues', () => {
    const vtt = [
      'WEBVTT',
      '',
      'STYLE',
      '::cue { background: url(https://evil.example/beacon) }',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'Hello there',
      ''
    ].join('\n')
    const out = stripVttStyles(vtt)
    expect(out).not.toContain('evil.example')
    expect(out).not.toContain('STYLE')
    expect(out).toContain('Hello there')
    expect(out).toContain('00:00:01.000 --> 00:00:02.000')
  })

  it('drops REGION blocks too', () => {
    const vtt = 'WEBVTT\n\nREGION\nid:fred\nwidth:40%\n\n00:00:01.000 --> 00:00:02.000\nHi\n'
    const out = stripVttStyles(vtt)
    expect(out).not.toContain('width:40%')
    expect(out).toContain('Hi')
  })

  it('leaves a plain file untouched', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nJust a cue\n'
    expect(stripVttStyles(vtt)).toBe(vtt)
  })
})
