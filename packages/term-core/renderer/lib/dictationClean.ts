/**
 * What is done to Whisper's text before it is pasted (#13). Deterministic only
 * (owner's decision: no second model), and deliberately timid: text typed into
 * a prompt cannot be taken back, so every rule here removes something that is
 * certainly not speech, and anything that MIGHT be what the user said is kept.
 * Whisper's own punctuation and capitalisation are never rewritten.
 *
 * ONE RULE IS NOT ABOUT TIDINESS: the result never carries a line break or any
 * other control character. Dictation is a written exception to "the app never
 * types into the user's shell" on the condition that it never presses Enter,
 * and the text travels as a bracketed paste, which an ESC in the text could
 * close early. So control characters go first, and the last thing done is a
 * whitespace collapse that leaves nothing but single spaces.
 */

/** Inside [ ], ( ) or * *, lowercased, with _ and - read as spaces. Whisper
 *  writes these for sound that is not speech; nobody dictates them in brackets. */
const ARTIFACTS = new Set([
  'blank audio',
  'silence',
  'no speech',
  'no audio',
  'inaudible',
  'unintelligible',
  'indistinct',
  'crosstalk',
  'music',
  'music playing',
  'applause',
  'clapping',
  'cheering',
  'laughter',
  'laughs',
  'laughing',
  'sighs',
  'sigh',
  'coughs',
  'cough',
  'coughing',
  'sniffs',
  'gasps',
  'groans',
  'breathing',
  'clears throat',
  'noise',
  'background noise',
  'static',
  'beep',
  'click',
  'clicking',
  'typing',
  'keyboard clicking',
  'wind',
  'footsteps',
  'pause'
])
/** "(upbeat music)", "[dramatic music playing]": one describing word, then music. */
const MUSIC_CUE = /^(?:[a-z]+ )?music(?: playing| plays| continues| fades)?$/

const SQUARE = /\[([^[\]]*)\]/g
const ROUND = /\(([^()]*)\)/g
/**
 * A stage direction: one to three plain words hard against their asterisks,
 * "*sighs*", "*clears throat*". More liberal than the bracket rule because
 * speech never produces a pair of asterisks, while "(music)" could be dictated;
 * and still shaped so that "2 * 3 * 4" and "*.ts and *.tsx" are left alone
 * (their content has a space at the edge, a digit or a dot).
 */
const STAGE_CUE = /\*[a-z]+(?: [a-z]+){0,2}\*/gi
/** The notes Whisper brackets singing with. Sharps and flats are not in it. */
const NOTES = /[\u2669-\u266c\u{1f3b5}\u{1f3b6}\u{1f3bc}]/gu

/** um, umm, uh, uhh, uhm, erm, hm, hmm, in any case and however long drawn. */
const FILLER = "(?:u+m+|u+h+m*|e+r+m+|h+m+)"
/** What makes the filler a WORD: nothing word-like against it on either side.
 *  Unicode-aware on purpose (\b is ASCII, and would cut "håum" at the å), and a
 *  hyphen or an apostrophe counts, so "uh-huh" is one word and stays. */
const NOT_AFTER = "(?<![\\p{L}\\p{N}'\u2019-])"
const NOT_BEFORE = "(?![\\p{L}\\p{N}'\u2019-])"
/**
 * A filler that LEADS a sentence goes with whatever punctuation hung off it, and
 * hands its capital to the word that now leads instead ("Um, so this" becomes
 * "So this"). Whisper had capitalised the filler; without this the sentence
 * would start lowercase through no fault of the speaker's. A sentence Whisper
 * itself left lowercase ("git status") is never touched.
 */
const LEADING_FILLER = new RegExp(`(^\\s*|[.!?\u2026]\\s+)${FILLER}${NOT_BEFORE}[,.!?\u2026]*\\s*(\\p{L})?`, 'giu')
/** Anywhere else it goes with a comma that directly follows it, and nothing more. */
const FILLER_WORD = new RegExp(`${NOT_AFTER}${FILLER}${NOT_BEFORE},?`, 'giu')

/** The same word twice with only space between. Letters only, so "2 2" and
 *  "10 10" are never a stutter; the back-reference is case-blind ("The the"). */
const DOUBLED = new RegExp(`${NOT_AFTER}(\\p{L}[\\p{L}'\u2019]*)\\s+\\1${NOT_BEFORE}`, 'giu')
/** Pairs people say on purpose. Small by design: a missed stutter costs the
 *  user one backspaced word, a wrongly joined pair changes what they said. */
const DELIBERATE_PAIRS = new Set(['that', 'had', 'bye', 'no', 'very', 'really', 'yeah', 'ha', 'knock', 'night', 'there'])

/** Removals leave punctuation stranded: "works, uh." is "works, ." by now. A
 *  full stop beats the comma before it; otherwise the first mark stands. The
 *  space between is required, so an ellipsis is never read as strays. */
const STRANDED = /([.,!?;:\u2026])\s+([.,])(?=\s|$)/g
/**
 * A space before , . ! ? ; : goes, but only where the mark ENDS something (space,
 * the end, or a closing quote or bracket follows). This is a terminal: "open
 * .gitignore" and "cd .." are things people say to it, and gluing the dot to
 * the word before would change the command. Two dots are left alone for that.
 */
const SPACE_BEFORE_MARK = /\s+((?:\.{3,}|[,!?;:\u2026]|\.(?!\.))+)(?=\s|$|["'\u2019\u201d)\]])/g
/** Marks a removal left at the very front. A dot is only stripped when it
 *  stands alone, so ".gitignore" keeps its own. */
const LEADING_MARKS = /^(?:[,;:\s]|[.!?\u2026]+(?=\s|$))+/
const HAS_WORD = /[\p{L}\p{N}]/u

/** Line breaks of every kind, ESC, NUL and the rest of C0 and C1, as spaces. By
 *  code point and not by regex: a control character in a pattern is what lint
 *  exists to stop, and a list of them is easier to check against a table. */
function withoutControls(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0
    out += c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? ' ' : ch
  }
  return out
}

function isArtifact(content: string): boolean {
  if (!HAS_WORD.test(content)) return true // "[ ]", "(...)": noise, not words
  const norm = content.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return ARTIFACTS.has(norm) || MUSIC_CUE.test(norm)
}

const dropArtifact = (whole: string, content: string): string => (isArtifact(content) ? ' ' : whole)

function pass(input: string): string {
  let text = input.replace(NOTES, ' ').replace(STAGE_CUE, ' ').replace(SQUARE, dropArtifact).replace(ROUND, dropArtifact)

  // One at a time from the front: each removal can put the NEXT filler at the
  // head of the sentence ("Um, uh, okay"), which a single global pass walks past.
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(LEADING_FILLER, (_m, lead: string, letter?: string) => lead + (letter ?? '').toUpperCase())
  }
  text = text.replace(FILLER_WORD, '')

  // To a standstill, since a global pass pairs "I I I" as (I I) I and stops.
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(DOUBLED, (m, word: string) => (DELIBERATE_PAIRS.has(word.toLowerCase()) ? m : word))
  }

  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(STRANDED, (_m, a: string, b: string) => (a === ',' ? b : a))
  }
  return text.replace(SPACE_BEFORE_MARK, '$1').replace(LEADING_MARKS, '').replace(/\s+/g, ' ').trim()
}

/**
 * Whisper's raw text in, the text to paste out. Returns '' when nothing that was
 * said is left (silence, a lone "[BLANK_AUDIO]", a lone "Um."), which the caller
 * shows as "Heard nothing" and pastes nothing for.
 */
export function cleanTranscript(raw: string): string {
  let text = withoutControls(raw).replace(/\s+/g, ' ').trim()
  // A removal can uncover the next one: "[um]" is a word in brackets until the
  // filler goes, and an empty bracket after. Run to a standstill, so cleaning a
  // cleaned text changes nothing; the cap is only there so a bug cannot hang a paste.
  for (let i = 0; i < 8; i += 1) {
    const next = pass(text)
    if (next === text) break
    text = next
  }
  return HAS_WORD.test(text) ? text : ''
}
