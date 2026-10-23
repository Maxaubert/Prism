import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_CHARS,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  NO_NOTES,
  moreLine,
  parseReleaseNotes
} from './releaseNotes'

// What `gh release create --generate-notes` writes, which is how both apps'
// releases are made. The comment on the first line is GitHub's own.
const GENERATED = [
  '<!-- Release notes generated using configuration in .github/release.yml at main -->',
  '',
  "## What's Changed",
  '* The update button opens a window with the patch notes by @Maxaubert in https://github.com/Maxaubert/PrismTerminal/pull/30',
  '* fix(ci): the bump edits four lockfile lines (#25) by @Maxaubert in https://github.com/Maxaubert/PrismTerminal/pull/26',
  '* Bump vite from 7.3.5 to 7.3.6 by @dependabot[bot] in https://github.com/Maxaubert/PrismTerminal/pull/31',
  '',
  '## New Contributors',
  '* @someone made their first contribution in https://github.com/Maxaubert/PrismTerminal/pull/31',
  '',
  '**Full Changelog**: https://github.com/Maxaubert/PrismTerminal/compare/v0.3.0...v0.4.0'
].join('\n')

/** Every string the dialog could ever print for a body. */
const allText = (body: unknown): string => parseReleaseNotes(body).entries.join('\n')

describe('parseReleaseNotes: a generated body', () => {
  const notes = parseReleaseNotes(GENERATED)

  it('is one plain entry per pull request, in order', () => {
    expect(notes.entries).toEqual([
      'The update button opens a window with the patch notes (#30)',
      'fix(ci): the bump edits four lockfile lines (#25) (#26)',
      'Bump vite from 7.3.5 to 7.3.6 (#31)'
    ])
    expect(notes.more).toBe(0)
    expect(notes.empty).toBe(false)
  })

  it('drops the author and the url, and keeps the pull request number as text', () => {
    expect(allText(GENERATED)).not.toMatch(/by @/)
    expect(allText(GENERATED)).not.toMatch(/https?:/)
    expect(notes.entries[0]).toMatch(/\(#30\)$/)
  })

  it('does not print a number the title already carries', () => {
    const one = parseReleaseNotes(
      '* Links are painted (#10) by @Maxaubert in https://github.com/Maxaubert/PrismTerminal/pull/10'
    )
    expect(one.entries).toEqual(['Links are painted (#10)'])
  })

  it('drops the heading, the new contributors and the full changelog', () => {
    const text = allText(GENERATED)
    expect(text).not.toMatch(/What's Changed/)
    expect(text).not.toMatch(/first contribution/)
    expect(text).not.toMatch(/someone/)
    expect(text).not.toMatch(/Full Changelog/)
    expect(text).not.toMatch(/Release notes generated/)
  })

  it('reads Windows line endings the same way', () => {
    expect(parseReleaseNotes(GENERATED.replace(/\n/g, '\r\n')).entries).toEqual(notes.entries)
  })

  it('takes a section that follows New Contributors back up', () => {
    const body = [
      '## New Contributors',
      '* @a made their first contribution in https://x.test/pull/1',
      '## Fixes',
      '* A real fix'
    ].join('\n')
    expect(parseReleaseNotes(body).entries).toEqual(['A real fix'])
  })

  it('strips an author with no url after it', () => {
    expect(parseReleaseNotes('* Fix the thing by @someone').entries).toEqual(['Fix the thing'])
  })

  it('keeps a title that names a handle and then says "in": only a url ends an author tail', () => {
    // The first build took ANY word after "in", and cut this down to "Mention people".
    expect(parseReleaseNotes('* Mention people by @handle in comments').entries).toEqual([
      'Mention people by @handle in comments'
    ])
    expect(
      parseReleaseNotes('* Mention people by @handle in comments by @me in https://x.test/pull/9')
        .entries
    ).toEqual(['Mention people by @handle in comments (#9)'])
  })

  it('keeps a "by" that is part of the title', () => {
    expect(
      parseReleaseNotes('* Sort by name by @someone in https://x.test/pull/4').entries
    ).toEqual(['Sort by name (#4)'])
  })
})

describe('parseReleaseNotes: nothing to show', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['whitespace', ' \n\t\r\n '],
    ['a number', 42],
    ['an object', { body: 'x' }],
    ['only boilerplate', "## What's Changed\n\n**Full Changelog**: https://x.test/compare/a...b"],
    ['only a comment', '<!-- nothing -->']
  ])('%s is one sensible line', (_name, body) => {
    expect(parseReleaseNotes(body)).toEqual({ entries: [NO_NOTES], more: 0, empty: true })
  })
})

describe('parseReleaseNotes: a body somebody wrote by hand', () => {
  it('reads dashes, pluses, numbers and task boxes as bullets', () => {
    const body = ['- one', '+ two', '1. three', '2) four', '- [x] five', '- [ ] six'].join('\n')
    expect(parseReleaseNotes(body).entries).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
  })

  it('reads a plain paragraph line as an entry', () => {
    expect(parseReleaseNotes('This release fixes the prompt.\n\nAnd the tabs.').entries).toEqual([
      'This release fixes the prompt.',
      'And the tabs.'
    ])
  })

  it('reads a paragraph wrapped over several lines as ONE entry, and a bullet ends it', () => {
    const body = 'This release fixes\nthe prompt.\n* and a bullet\nthen prose again\n\nAnd the tabs.'
    expect(parseReleaseNotes(body).entries).toEqual([
      'This release fixes the prompt.',
      'and a bullet',
      'then prose again',
      'And the tabs.'
    ])
  })

  it('joins an indented continuation onto the bullet above it', () => {
    expect(parseReleaseNotes('* a long\n  title wrapped\n* next').entries).toEqual([
      'a long title wrapped',
      'next'
    ])
  })

  it('drops headings and rules, whatever they say', () => {
    expect(parseReleaseNotes('# Big\n### Small\n---\n***\n* kept').entries).toEqual(['kept'])
  })

  it('collapses whitespace', () => {
    expect(parseReleaseNotes('*   a \t  b    c  ').entries).toEqual(['a b c'])
  })
})

describe('parseReleaseNotes: it is text off the network', () => {
  it('turns a markdown link into its text, never its target', () => {
    const text = allText(
      '* See [the docs](https://evil.test/login) and [this](javascript:alert(1))'
    )
    expect(text).toBe('See the docs and this')
  })

  it('turns an image into its alt text', () => {
    expect(allText('* Look ![a screenshot](https://x.test/a.png) here')).toBe(
      'Look a screenshot here'
    )
  })

  it('strips html, tags and comments alike', () => {
    const text = allText(
      '* Hello <img src=x onerror="alert(1)"> <b>bold</b><!-- hidden\nacross lines --> <script>alert(2)</script> world'
    )
    expect(text).not.toMatch(/<[a-z!/]/i)
    expect(text).not.toMatch(/onerror|hidden/)
    expect(text).toContain('Hello')
    expect(text).toContain('world')
  })

  it('is not fooled by a tag hidden inside a tag', () => {
    expect(allText('* a <scr<script>ipt>alert(1)</scr</script>ipt> b')).not.toMatch(/<\/?script/i)
  })

  it('leaves a lone angle bracket alone: it is only text', () => {
    expect(allText('* a -> b, and x < y')).toBe('a -> b, and x < y')
  })

  it('strips emphasis marks and code ticks, and keeps snake_case', () => {
    expect(allText('* **Bold** and `code` and ~~gone~~ and snake_case_name')).toBe(
      'Bold and code and gone and snake_case_name'
    )
  })

  it('strips control characters and the marks that reorder text', () => {
    // U+202E flips what follows: "exe.txt" can be made to read "txt.exe".
    const text = allText('* safe\u202Eevil\u2066x\u2069\u200B\u0007\u0000 end')
    expect(text).toBe('safeevilx end')
  })

  it('never returns anything but strings, and never an empty one', () => {
    const notes = parseReleaseNotes('* \n* <b></b>\n* real\n* ``')
    expect(notes.entries).toEqual(['real'])
  })
})

describe('parseReleaseNotes: the caps', () => {
  it('cuts a long entry, with an ellipsis, to the cap exactly', () => {
    const notes = parseReleaseNotes('* ' + 'word '.repeat(200))
    expect(notes.entries[0].length).toBeLessThanOrEqual(MAX_ENTRY_CHARS)
    expect(notes.entries[0].endsWith('…')).toBe(true)
  })

  it('keeps the pull request number when it cuts the title', () => {
    const notes = parseReleaseNotes('* ' + 'word '.repeat(200) + 'by @a in https://x.test/pull/77')
    expect(notes.entries[0].length).toBeLessThanOrEqual(MAX_ENTRY_CHARS)
    expect(notes.entries[0].endsWith('… (#77)')).toBe(true)
  })

  it('leaves an entry of exactly the cap alone', () => {
    const exact = 'x'.repeat(MAX_ENTRY_CHARS)
    expect(parseReleaseNotes('* ' + exact).entries).toEqual([exact])
  })

  it('shows the first entries and counts the rest', () => {
    const body = Array.from({ length: MAX_ENTRIES + 7 }, (_, i) => `* change ${i + 1}`).join('\n')
    const notes = parseReleaseNotes(body)
    expect(notes.entries).toHaveLength(MAX_ENTRIES)
    expect(notes.entries[0]).toBe('change 1')
    expect(notes.more).toBe(7)
  })

  it('counts nothing when the list fits exactly', () => {
    const body = Array.from({ length: MAX_ENTRIES }, (_, i) => `* change ${i + 1}`).join('\n')
    expect(parseReleaseNotes(body).more).toBe(0)
  })

  it('reads only the head of an enormous body, and quickly', () => {
    const body = '* line\n'.repeat(400_000)
    expect(body.length).toBeGreaterThan(MAX_BODY_CHARS)
    const t0 = Date.now()
    const notes = parseReleaseNotes(body)
    expect(Date.now() - t0).toBeLessThan(500)
    expect(notes.entries).toHaveLength(MAX_ENTRIES)
    // What is counted is what was read, not the two megabytes behind it.
    expect(notes.more).toBeLessThan(MAX_BODY_CHARS / '* line\n'.length)
  })

  it('does not hang on a line built to make a regex backtrack', () => {
    const t0 = Date.now()
    parseReleaseNotes(
      '* ' + '[a]('.repeat(3000) + ' by @' + 'a-'.repeat(3000) + ' in ' + '<'.repeat(3000)
    )
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('moreLine', () => {
  it('says how many were left out', () => {
    expect(moreLine(1)).toBe('+ 1 more')
    expect(moreLine(12)).toBe('+ 12 more')
  })
})
