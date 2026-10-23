import { describe, expect, it } from 'vitest'
import { cleanTranscript } from './dictationClean'

describe('what Whisper wrote is kept', () => {
  it('leaves punctuation and capitalisation alone', () => {
    expect(cleanTranscript(' Ask not what your country can do for you.')).toBe(
      'Ask not what your country can do for you.'
    )
    expect(cleanTranscript("Wait, really? Yes! It's 3.5 GB; see: the log.")).toBe(
      "Wait, really? Yes! It's 3.5 GB; see: the log."
    )
  })
  it('does not capitalise a sentence Whisper left lowercase', () => {
    expect(cleanTranscript('git status')).toBe('git status')
  })
  it('keeps an ellipsis', () => {
    expect(cleanTranscript('Well... maybe.')).toBe('Well... maybe.')
  })
})

describe('engine artifacts', () => {
  it.each([
    '[BLANK_AUDIO]',
    '[ Silence ]',
    '[silence]',
    '(music)',
    '[Music]',
    '[MUSIC PLAYING]',
    '(applause)',
    '[inaudible]',
    '[NO_SPEECH]',
    '(upbeat music)',
    '*sighs*',
    '*clears throat*',
    '♪',
    '♪♪ ♫',
    '[ ]',
    '(...)',
    '[BLANK_AUDIO] [BLANK_AUDIO]',
    '[BLANK_AUDIO].'
  ])('%s alone is nothing', (raw) => {
    expect(cleanTranscript(raw)).toBe('')
  })

  it('takes them out of the middle of speech', () => {
    expect(cleanTranscript('Run the tests [BLANK_AUDIO] and then push.')).toBe('Run the tests and then push.')
    expect(cleanTranscript('Hello (music) world.')).toBe('Hello world.')
    expect(cleanTranscript('Okay *sighs* fine.')).toBe('Okay fine.')
    expect(cleanTranscript('♪ Happy birthday to you ♪')).toBe('Happy birthday to you')
  })

  it('does not strip parentheses a speaker dictated around real words', () => {
    expect(cleanTranscript('Add a note (see the README) at the end.')).toBe('Add a note (see the README) at the end.')
    expect(cleanTranscript('Index [0] and step (1).')).toBe('Index [0] and step (1).')
    expect(cleanTranscript('The (music) folder is separate from (my music library).')).toBe(
      'The folder is separate from (my music library).'
    )
  })

  it('does not take a multiplication for a stage direction', () => {
    expect(cleanTranscript('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(cleanTranscript('Match *.ts and *.tsx files')).toBe('Match *.ts and *.tsx files')
  })

  it('unwraps a nest of them', () => {
    expect(cleanTranscript('[ [music] ] hi')).toBe('hi')
  })
})

describe('fillers', () => {
  it('removes um, uh, erm, uhm and hmm as whole words, with the comma that follows', () => {
    expect(cleanTranscript('I think, um, that works.')).toBe('I think, that works.')
    expect(cleanTranscript('So uh we ship it erm today uhm yes hmm.')).toBe('So we ship it today yes.')
    expect(cleanTranscript('It is UM, fine.')).toBe('It is fine.')
    expect(cleanTranscript('It is ummm, fine, uhh.')).toBe('It is fine.')
  })
  it('does not touch words that contain them', () => {
    const s = 'The umbrella will hum; Uhura hummed, the drummer erred.'
    expect(cleanTranscript(s)).toBe(s)
  })
  it('leaves a hyphenated word whole', () => {
    expect(cleanTranscript('He said uh-huh twice.')).toBe('He said uh-huh twice.')
  })
  it('capitalises a sentence its filler used to lead', () => {
    expect(cleanTranscript('Um, so this is the plan.')).toBe('So this is the plan.')
    expect(cleanTranscript('uh list the files')).toBe('List the files')
    expect(cleanTranscript('Um. Uh, okay then.')).toBe('Okay then.')
    expect(cleanTranscript('Done. Um, next one.')).toBe('Done. Next one.')
    expect(cleanTranscript('[BLANK_AUDIO] Um, hello.')).toBe('Hello.')
  })
  it('leaves no orphaned punctuation behind', () => {
    expect(cleanTranscript('Right. Um. Okay.')).toBe('Right. Okay.')
    expect(cleanTranscript('That works, uh.')).toBe('That works.')
    expect(cleanTranscript('Um.')).toBe('')
    expect(cleanTranscript('Um, uh, erm...')).toBe('')
  })
})

describe('doubled words', () => {
  it('collapses an immediate double, keeping the first', () => {
    expect(cleanTranscript('Open the the file.')).toBe('Open the file.')
    expect(cleanTranscript('The the file.')).toBe('The file.')
    expect(cleanTranscript('I I I think so.')).toBe('I think so.')
    expect(cleanTranscript('go to to the the root')).toBe('go to the root')
  })
  it('collapses one a filler was hiding', () => {
    expect(cleanTranscript('Open the, um, the file.')).toBe('Open the, the file.')
    expect(cleanTranscript('Open the um the file.')).toBe('Open the file.')
  })
  it('never touches digits', () => {
    expect(cleanTranscript('Version 2 2 and 10 10.')).toBe('Version 2 2 and 10 10.')
  })
  it('keeps the pairs people say on purpose', () => {
    const s = 'I know that that is what he had had. No no, bye bye.'
    expect(cleanTranscript(s)).toBe(s)
  })
  it('does not see a double inside longer words', () => {
    expect(cleanTranscript('the theme, an answer, is isolated')).toBe('the theme, an answer, is isolated')
  })
  it('works past ASCII', () => {
    expect(cleanTranscript('Jeg så så filen og og åpnet den.')).toBe('Jeg så filen og åpnet den.')
  })
  it('does not reach across a full stop or a comma', () => {
    expect(cleanTranscript('Yes. Yes, it is.')).toBe('Yes. Yes, it is.')
  })
})

describe('whitespace', () => {
  it('turns segment breaks and tabs into single spaces, and trims', () => {
    expect(cleanTranscript('  First line.\n Second line.\r\n\tThird.  ')).toBe('First line. Second line. Third.')
  })
  it('removes a space before punctuation', () => {
    expect(cleanTranscript('Hello , world ! Is it ? Yes ; here : now .')).toBe('Hello, world! Is it? Yes; here: now.')
  })
  it('does not glue a dotfile or a relative path to the word before it', () => {
    expect(cleanTranscript('open .gitignore and cd ..')).toBe('open .gitignore and cd ..')
    expect(cleanTranscript('.gitignore is listed')).toBe('.gitignore is listed')
    expect(cleanTranscript('wait ... what')).toBe('wait... what')
  })
  it('returns nothing for nothing', () => {
    expect(cleanTranscript('')).toBe('')
    expect(cleanTranscript(' \n\t ')).toBe('')
    expect(cleanTranscript('...')).toBe('')
  })
})

describe('the app never sends Enter', () => {
  // Not a fixed list alone: a seeded generator glues the nastiest pieces together
  // in orders nobody wrote down, so the rule is tested as a property.
  const PIECES = [
    '\n', '\r', '\r\n', '\n\n\n', '\t', '\v', '\f', '\u2028', '\u2029', '\u0085', '\u001b[201~', '\u0000', '\u0007',
    '\u00a0', ' ', '  ', 'um', 'Um,', 'uh', '[BLANK_AUDIO]', '(music)', '[', ']', '(', ')', '*', '*sighs*', '♪',
    'the', 'the', 'The', 'word', '.', ',', '!', '?', ';', ':', '...', 'ls -la', 'rm -rf /', '&&', '"', "'", 'å', '日本語',
    '\ud83c\udfb5', '\ud83d', 'x'.repeat(40)
  ]
  function* nasty(count: number): Generator<string> {
    let seed = 0x2f6e2b1
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed
    }
    for (let i = 0; i < count; i += 1) {
      const n = 1 + (next() % 12)
      let s = ''
      for (let j = 0; j < n; j += 1) s += PIECES[next() % PIECES.length] + (next() % 3 === 0 ? '' : ' ')
      yield s
    }
  }

  it('never returns a line break, a control character or an untrimmed edge', () => {
    const inputs = [...PIECES, PIECES.join(''), PIECES.join('\n'), ...nasty(3000)]
    for (const raw of inputs) {
      const out = cleanTranscript(raw)
      const where = JSON.stringify(raw)
      expect(/[\n\r\u2028\u2029\u0085\v\f]/.test(out), where).toBe(false)
      expect([...out].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f), where).toBe(false)
      expect(out, where).toBe(out.trim())
      expect(/ {2}/.test(out), where).toBe(false)
    }
  })

  it('is stable: cleaning a cleaned text changes nothing', () => {
    for (const raw of nasty(1500)) {
      const once = cleanTranscript(raw)
      expect(cleanTranscript(once), JSON.stringify(raw)).toBe(once)
    }
  })

  it('cannot be made to close the bracketed paste it travels in', () => {
    expect(cleanTranscript('echo hi\u001b[201~\nrm -rf x')).not.toContain('\u001b')
  })
})
