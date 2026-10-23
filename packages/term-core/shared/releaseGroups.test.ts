import { describe, expect, it } from 'vitest'
import { SAMPLE_NOTES } from '../main/updatePreview'
import { classifyEntry, groupReleaseNotes } from './releaseGroups'
import { parseReleaseNotes } from './releaseNotes'

describe('classifyEntry: where a title goes', () => {
  it('reads a conventional prefix, and takes it off', () => {
    expect(classifyEntry('fix(terminal): a prompt survives a resize (#31)')).toEqual({
      kind: 'fixes',
      text: 'A prompt survives a resize'
    })
    expect(classifyEntry('feat: dictation')).toEqual({ kind: 'features', text: 'Dictation' })
    expect(classifyEntry('perf(search): one collator, not five thousand')).toMatchObject({
      kind: 'improvements'
    })
    expect(classifyEntry('refactor(core)!: the host seam')).toEqual({
      kind: 'improvements',
      text: 'The host seam'
    })
    for (const p of ['docs', 'chore', 'build', 'ci', 'test', 'revert'])
      expect(classifyEntry(`${p}: something`).kind).toBe('internal')
  })

  it('calls an unmarked title a feature, which in these repos it nearly always is', () => {
    expect(classifyEntry('Dictation: speak into the terminal (#22)')).toEqual({
      kind: 'features',
      text: 'Dictation: speak into the terminal'
    })
  })

  it('keeps a prefix that names a PART OF THE APP: only a commit type is taken off', () => {
    expect(classifyEntry('Phone: a cleaner tab drawer').text).toBe('Phone: a cleaner tab drawer')
    expect(classifyEntry('Command help: a searchable popup').kind).toBe('features')
  })

  it('reads an unprefixed fix as one, keeping its verb but not a bare label', () => {
    expect(classifyEntry('Fix the prompt after a resize')).toEqual({
      kind: 'fixes',
      text: 'Fix the prompt after a resize'
    })
    expect(classifyEntry('Fixes: the prompt after a resize').text).toBe('The prompt after a resize')
    expect(classifyEntry('Fixed - the prompt after a resize').text).toBe('The prompt after a resize')
  })

  it('is not fooled by a word that only starts like one', () => {
    expect(classifyEntry('Fixed-width font option')).toEqual({
      kind: 'features',
      text: 'Fixed-width font option'
    })
    expect(classifyEntry('Fixture loading is faster').kind).toBe('features')
  })

  it('files the bots under the hood', () => {
    expect(classifyEntry('Bump electron from 43.1.0 to 43.1.1 (#34)')).toEqual({
      kind: 'internal',
      text: 'Bump electron from 43.1.0 to 43.1.1'
    })
    expect(
      classifyEntry('Terminal core: prism-term-core core-v0.4.0 (Prism 0.57.0) (#177)').kind
    ).toBe('internal')
  })

  it('drops every pull request number at the end, and only at the end', () => {
    expect(classifyEntry('Window edges setting (#27) (#29)').text).toBe('Window edges setting')
    expect(classifyEntry('Closes (#12) properly').text).toBe('Closes (#12) properly')
  })

  it('never returns an empty line: a title that was only a prefix stays as it came', () => {
    expect(classifyEntry('fix: (#9)').text).toBe('fix: (#9)')
    expect(classifyEntry('(#9)').text).toBe('(#9)')
  })
})

describe('groupReleaseNotes', () => {
  it('sorts the preview body under headings, in reading order, each line worded for a reader', () => {
    const sections = groupReleaseNotes(parseReleaseNotes(SAMPLE_NOTES))
    expect(sections.map((s) => s.heading)).toEqual(['New features', 'Bug fixes', 'Under the hood'])
    expect(sections[0].entries[0]).toBe(
      'The update button opens a window with the patch notes, Cancel and Install'
    )
    expect(sections[1].entries).toEqual([
      'A prompt survives the window getting narrower and wider again',
      'Closing a tab that hosts an agent asks first, working or idle'
    ])
    expect(sections[2].entries).toEqual(['Bump electron from 43.1.0 to 43.1.1'])
    const all = sections.flatMap((s) => s.entries)
    // Nothing is lost on the way, and nothing still reads like `git log`.
    expect(all).toHaveLength(parseReleaseNotes(SAMPLE_NOTES).entries.length)
    for (const line of all) {
      expect(line).not.toMatch(/\(#\d+\)\s*$/)
      expect(line).not.toMatch(/^[a-z]+(\([^)]*\))?!?:/)
      expect(line[0]).toBe(line[0].toUpperCase())
    }
  })

  it('leaves an empty section out, and keeps the order within one', () => {
    const sections = groupReleaseNotes(parseReleaseNotes('* fix: b\n* fix: a'))
    expect(sections).toEqual([{ kind: 'fixes', heading: 'Bug fixes', entries: ['B', 'A'] }])
  })

  it('has nothing to say about a body with no notes: the window prints the stand-in', () => {
    expect(groupReleaseNotes(parseReleaseNotes(null))).toEqual([])
    expect(groupReleaseNotes(parseReleaseNotes(''))).toEqual([])
  })

  it('only moves strings about: a hostile title comes out as the same harmless text', () => {
    const sections = groupReleaseNotes(parseReleaseNotes('* fix: <img src=x onerror=alert(1)> x'))
    for (const s of sections) for (const e of s.entries) expect(e).not.toMatch(/<[a-zA-Z]/)
  })
})
