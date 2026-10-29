import type { UpdateInfo } from '../shared/updateTypes'

// A FAKE UPDATE, to look at (#28). Owner, 2026-09-19: "I would want to see how
// the Update banner looks in both apps, so if you could enable it and make
// like a fake update."
//
// `--preview-update` on the command line of either app, the INSTALLED one
// included, makes main announce the offer below at once. What the flag
// promises, and what the e2e holds it to: the network is never touched, nothing
// is downloaded, no installer is spawned and the app does not quit. Install
// runs the fake progress in this file and ends by saying so.
//
// It is here, in the core, so the two apps show the same preview of the same
// window. No electron and no timers of its own that a test cannot replace.

export const PREVIEW_FLAG = '--preview-update'

/** Exact match only. Chromium reorders its own switches round ours, so the
 *  position means nothing; and a near miss (`--preview-updates`) is not it. */
export const wantsPreview = (argv: readonly string[]): boolean => argv.includes(PREVIEW_FLAG)

/** The next minor after `current`: the release that would plausibly follow. A
 *  version that is not one still gets an answer, since this is only a label. */
export function previewVersion(current: string): string {
  const [major, minor] = current
    .replace(/^v/i, '')
    .split('.')
    .map((n) => (/^\d+$/.test(n) ? Number(n) : 0))
  return `${major ?? 0}.${(minor ?? 0) + 1}.0`
}

/**
 * A body in the shape `gh release create --generate-notes` writes, which is how
 * both apps' releases are made: GitHub's comment, the heading, a line per pull
 * request with its author and url, new contributors, the compare link. RAW on
 * purpose. The preview is of the whole path, parser included, so what the
 * dialog shows for this is what it will show for a real release.
 */
export const SAMPLE_NOTES = [
  '<!-- Release notes generated using configuration in .github/release.yml at main -->',
  '',
  "## What's Changed",
  '* The update button opens a window with the patch notes, Cancel and Install by @Maxaubert in https://github.com/Maxaubert/Prism/pull/30',
  '* A cut row looks cut, and a paste shows its items as they copy (#452) by @Maxaubert in https://github.com/Maxaubert/Prism/pull/453',
  '* feat(explorer): Downloads keeps its newest-first order by @Maxaubert in https://github.com/Maxaubert/Prism/pull/440',
  '* fix(viewer): a picture keeps its zoom when the window gets narrower and wider again by @Maxaubert in https://github.com/Maxaubert/Prism/pull/431',
  '* fix(tabs): closing the last tab closes the window, from every route by @Maxaubert in https://github.com/Maxaubert/Prism/pull/432',
  '* Links are painted in a colour that follows the theme by @Maxaubert in https://github.com/Maxaubert/Prism/pull/433',
  '* Bump electron from 43.1.0 to 43.1.1 by @dependabot[bot] in https://github.com/Maxaubert/Prism/pull/434',
  '',
  '## New Contributors',
  '* @dependabot[bot] made their first contribution in https://github.com/Maxaubert/Prism/pull/434',
  '',
  '**Full Changelog**: https://github.com/Maxaubert/Prism/compare/v0.118.0...v0.119.0'
].join('\n')

/** The offer a preview announces. No url: there is nothing to download. */
export const previewUpdate = (current: string): UpdateInfo => ({
  version: previewVersion(current),
  url: '',
  notes: SAMPLE_NOTES,
  mock: true
})

/** How long the fake install takes in all: long enough to watch the bar fill
 *  and read "Installing", short enough to run twice in a row. */
export const PREVIEW_MS = 3000

/**
 * The fake install: percentages to 100 over most of `ms`, then a hold while the
 * window reads "Installing", then FALSE, the same answer a real install gives
 * when nothing was installed. That is the truth, and it is what sends the flow
 * back to idle; the page adds the line that says it was a preview.
 *
 * It does nothing else. No fetch, no file, no child process, no quit.
 *
 * `cancelled` (#32) is asked before every step of the DOWNLOAD and ends it
 * there, with the same false: the window's Cancel has to be seen working in a
 * preview, since a preview is the only place most people will ever press it.
 * It is not asked during the hold, as a real install cannot be cancelled once
 * the installer has the file.
 */
export async function runPreviewInstall(
  onPct: (pct: number) => void,
  opts: { ms?: number; wait?: (ms: number) => Promise<void>; cancelled?: () => boolean } = {}
): Promise<false> {
  const ms = opts.ms ?? PREVIEW_MS
  const wait = opts.wait ?? ((t: number) => new Promise<void>((r) => setTimeout(r, t)))
  const STEPS = 20
  const hold = Math.round(ms * 0.2)
  const tick = (ms - hold) / STEPS
  let waited = 0
  onPct(0)
  for (let i = 1; i <= STEPS; i += 1) {
    // Whole milliseconds that still add up to exactly the total.
    const upTo = Math.round(tick * i)
    await wait(upTo - waited)
    waited = upTo
    if (opts.cancelled?.()) return false
    onPct(Math.round((100 * i) / STEPS))
  }
  await wait(hold)
  return false
}
