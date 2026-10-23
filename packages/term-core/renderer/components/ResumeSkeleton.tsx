import type { CSSProperties, JSX } from 'react'

/**
 * THE SKELETON OF AN AGENT COMING BACK (#106; owner, 2026-09-30, of the
 * mockups: "C is good"; then, of the first build: "it's too small, it should
 * cover much more of the window ... not that bottom claude input bar thing,
 * only the lines"). While a restored tab resumes Claude or Codex, this is
 * drawn over its terminal: the logo block at the top, then a whole page of
 * lines in paragraphs, down to the window's bottom edge, so the wait reads as
 * a conversation loading and not a script running.
 *
 * Every colour is the theme's (`--p-text` over the panel's ground), so it
 * follows any preset and a picked background. The lines pulse slowly; under
 * reduced motion they are still. In the page only while it shows, so it
 * leaves no status line behind (the copied badge's rule, #58).
 */
const LINE: CSSProperties = {
  height: 11,
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--p-text) 7%, transparent)'
}

/** Paragraphs of line lengths (percent of the width), fixed so the page
 *  never jumps between renders. More than any window is tall: the rest is
 *  cut off at the bottom edge. */
const PARAGRAPHS: number[][] = [
  [62],
  [88, 94, 71, 38],
  [79, 91, 56],
  [84, 67, 92, 88, 44],
  [58],
  [93, 81, 74, 29],
  [86, 90, 63],
  [70, 95, 83, 52],
  [89, 61],
  [92, 77, 85, 40],
  [66, 90, 58],
  [83, 94, 72, 47]
]

export function ResumeSkeleton({ leaving = false }: { leaving?: boolean }): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Resuming conversation"
      data-resume-skeleton={leaving ? 'leaving' : 'shown'}
      className={`absolute inset-0 z-[1] overflow-hidden bg-[var(--p-bg)] px-4 pt-4 transition-opacity duration-[180ms] ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col gap-[26px] motion-safe:animate-pulse">
        {/* The logo block, and the name, model and folder beside it. */}
        <div className="flex gap-6">
          <div className="flex w-[9%] min-w-[64px] flex-col gap-[10px]">
            <span style={{ ...LINE, width: '90%' }} />
            <span style={{ ...LINE, width: '100%' }} />
            <span style={{ ...LINE, width: '90%' }} />
          </div>
          <div className="flex flex-1 flex-col gap-[10px]">
            <span style={{ ...LINE, width: '26%' }} />
            <span style={{ ...LINE, width: '20%' }} />
            <span style={{ ...LINE, width: '38%' }} />
          </div>
        </div>
        {/* The conversation, as a page of lines. */}
        {PARAGRAPHS.map((para, i) => (
          <div key={i} className="flex flex-col gap-[10px]">
            {para.map((w, j) => (
              <span key={j} style={{ ...LINE, width: `${w}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
