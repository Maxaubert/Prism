// A GitHub release body, turned into something safe to show (#28).
//
// Owner, 2026-09-19: "when you click the Update badge, it opens like a pop
// window, which shows the change log or like patch notes for the new update".
// The notes are the release's body, and that is TEXT OFF THE NETWORK arriving
// in a window that can reach the app's bridge to main. So the rule, which is
// the whole reason this file exists: the body is NEVER rendered. Not as HTML,
// not as markdown, not as links. It is reduced here to a short list of plain
// strings, and the dialog prints each one as a text node, which React escapes.
// There is deliberately no markdown library and no `dangerouslySetInnerHTML`
// anywhere on this path, so there is nothing to sanitise and nothing to get
// wrong later: a string that says <script> is only a string that says so.
//
// The stripping below is therefore about READING WELL, not about safety. Both
// apps' releases are made by `gh release create --generate-notes`, whose body
// is a "What's Changed" heading, one line per pull request
// ("* <title> by @user in <url>"), sometimes a "New Contributors" section, and
// a "Full Changelog" compare link. What a user wants from that is the titles.
// The author and the url are dropped (a url printed as text is noise, and it
// must not become an anchor), and the pull request's number is kept as text,
// since it is the one handle somebody can look a change up by.
//
// Pure, no DOM, no imports: it runs the same in main, in the page and in tests.

/** How many entries the dialog lists; the rest are counted, not shown. */
export const MAX_ENTRIES = 20
/** One entry is one line or two in the dialog, never a paragraph. */
export const MAX_ENTRY_CHARS = 160
/** Only the head of a body is ever read: a release body is a few kilobytes,
 *  and one that is not must cost the same to refuse as to read. */
export const MAX_BODY_CHARS = 20_000

/** What stands in for a release that came with no notes, or none worth a line. */
export const NO_NOTES = 'No notes were published with this release.'

export interface ReleaseNotes {
  /** Plain text, never empty strings, never more than MAX_ENTRIES. */
  entries: string[]
  /** How many further entries were read and left out. */
  more: number
  /** True when the body gave nothing and `entries` is the one stand-in line,
   *  so the dialog can set it as a sentence and not as a bullet. */
  empty: boolean
}

/** The line under a capped list. */
export const moreLine = (n: number): string => `+ ${n} more`

// C0 and C1 controls (tab, LF and CR are kept: the body is split on them),
// zero-width characters, and the bidirectional overrides and isolates. The last
// group is the one that matters in a window asking "install this?": U+202E
// makes the text after it read backwards, which is how "exe.txt" is made to
// look like "txt.exe".
const UNPRINTABLE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g

const HTML_COMMENT = /<!--[\s\S]*?-->/g
// A script or style element goes with what is inside it: with only the tags
// stripped, its source would be printed as if it were a change.
const HTML_BLOCK = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi
const HTML_TAG = /<\/?[a-zA-Z][^<>]*>/g
const TAG_LIKE = /<[a-zA-Z!/]/

/** Tags out. A tag can be hidden inside a tag (`<scr<script>ipt>`), so one pass
 *  can MAKE a tag; a few passes, and then whatever still opens one loses its
 *  bracket. A lone `<` that opens nothing is left: "x < y" is only text. */
function stripHtml(s: string): string {
  let out = s.replace(HTML_COMMENT, ' ').replace(HTML_BLOCK, ' ')
  for (let i = 0; i < 4 && TAG_LIKE.test(out); i += 1) out = out.replace(HTML_TAG, ' ')
  return TAG_LIKE.test(out) ? out.replace(/<(?=[a-zA-Z!/])/g, '') : out
}

const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^\s*(?:[*+-]|\d{1,9}[.)])(?:\s+|$)(?:\[[ xX]\]\s+)?/
const FULL_CHANGELOG = /^\W*full changelog\b/i
// "by @user in <url>", which generate-notes appends to every title. The url is
// optional so a hand-written "by @user" goes too. It must sit at the END: a
// title is free to say "sort by name". And what follows "in" must BE a url:
// the first build took any word there, so "Mention people by @handle in
// comments" was cut down to "Mention people" (found in review, 2026-09-20).
const AUTHOR_TAIL = /\s+by\s+@[\w-]+(?:\[bot\])?(?:\s+in\s+(https?:\/\/\S+))?\s*$/i
const PR_NUMBER = /\/(?:pull|issues)\/(\d{1,9})\/?$/

// [text](target) and ![alt](target): the text stays, the target never does.
// One level of brackets inside the target, which is all a real url carries.
const MD_LINK = /!?\[([^[\]]*)\]\([^()\s]*(?:\([^()\s]*\))?[^()\s]*\)/g

/** Cut to `limit` characters, ellipsis included, never through a surrogate pair. */
function cut(s: string, limit: number): string {
  if (s.length <= limit) return s
  let head = s.slice(0, Math.max(0, limit - 1))
  const last = head.charCodeAt(head.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1)
  return head.trimEnd() + '…'
}

/** One raw entry (a bullet and whatever wrapped under it) as a plain line. */
function cleanEntry(raw: string): string {
  let text = raw
  let ref = ''
  const tail = AUTHOR_TAIL.exec(text)
  if (tail) {
    text = text.slice(0, tail.index)
    const n = tail[1] ? PR_NUMBER.exec(tail[1]) : null
    if (n) ref = `#${n[1]}`
  }
  text = text
    .replace(MD_LINK, '$1')
    .replace(/\*\*|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  // The number is kept as TEXT, and only when the title does not already say
  // it (a squash merge's title usually does not, a merge commit's often does).
  const suffix = ref && !new RegExp(`${ref}(?!\\d)`).test(text) ? ` (${ref})` : ''
  return cut(text, MAX_ENTRY_CHARS - suffix.length) + suffix
}

/**
 * The entries of a release body. `body` is `unknown` on purpose: it is a field
 * of somebody else's JSON, and "missing", "null" and "not a string" all mean
 * the same thing here, which is that there are no notes.
 */
export function parseReleaseNotes(body: unknown): ReleaseNotes {
  const none: ReleaseNotes = { entries: [NO_NOTES], more: 0, empty: true }
  if (typeof body !== 'string') return none

  let text = body
  if (text.length > MAX_BODY_CHARS) {
    // Back to the last whole line, so the cut never invents half an entry.
    text = text.slice(0, MAX_BODY_CHARS)
    const nl = text.lastIndexOf('\n')
    if (nl > 0) text = text.slice(0, nl)
  }
  text = stripHtml(text.replace(UNPRINTABLE, ''))

  const raw: string[] = []
  let skipping = false // inside "New Contributors", until the next heading
  let open = false // the last entry can still take a wrapped line
  // The last entry is a PARAGRAPH still running: prose somebody wrote by hand
  // is wrapped at a column, and each of its lines is not a change of its own
  // ("This release fixes" and "the prompt." as two bullets). A blank line, a
  // heading or a bullet ends it.
  let para = false
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) {
      open = para = false
      continue
    }
    if (HEADING.test(line)) {
      skipping = /new contributors/i.test(line)
      open = para = false
      continue
    }
    if (skipping || RULE.test(line) || FULL_CHANGELOG.test(line)) {
      open = para = false
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet) {
      raw.push(line.slice(bullet[0].length))
      open = true
      para = false
    } else if ((open && /^\s/.test(line)) || para) {
      raw[raw.length - 1] += ' ' + line.trim()
    } else {
      raw.push(line)
      open = false
      para = true
    }
  }

  const all = raw.map(cleanEntry).filter((e) => e !== '')
  if (!all.length) return none
  return {
    entries: all.slice(0, MAX_ENTRIES),
    more: Math.max(0, all.length - MAX_ENTRIES),
    empty: false
  }
}
