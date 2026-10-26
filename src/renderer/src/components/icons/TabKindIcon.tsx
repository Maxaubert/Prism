import type { JSX } from 'react'
import { PATHS } from './paths'

/** What a tab holds, as its icon says it (#308). */
export type TabKind = 'explorer' | 'settings'

/* The C2 drawings from the approved mockup (owner, 2026-10-07: "A3 and C2";
   research/prism/2026-10-06-new-themes/toolbar-options.html). Lines on the
   tabs you are not on, solid on the one you are: a second cue next to the
   accent rule along the top. */
const FOLDER = PATHS.folderRound
const FOLDER_SOLID =
  'M2.5 6.5A1.5 1.5 0 0 1 4 5h5.2l2 2H20a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5z'
const GEAR =
  'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'

const SIZE = 14

/**
 * The tab's own icon, in the tab's ink (currentColor): the label's dim grey
 * on a tab at rest, its brighter text on the one you are on and under a
 * hover, Never a colour of its own
 * (owner, 2026-10-06: "i dont like the look of the buttons being colored").
 */
export function TabKindIcon({ kind, solid }: { kind: TabKind; solid: boolean }): JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    width: SIZE,
    height: SIZE,
    className: 'shrink-0',
    'data-tab-icon': kind,
    'data-tab-icon-fill': solid ? 'solid' : 'outline',
    'aria-hidden': true
  } as const
  if (!solid)
    return (
      <svg
        {...common}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={kind === 'explorer' ? FOLDER : GEAR} />
      </svg>
    )
  if (kind === 'explorer')
    return (
      <svg {...common}>
        <path d={FOLDER_SOLID} fill="currentColor" />
      </svg>
    )
  return (
    <svg {...common}>
      <path
        d={GEAR}
        fill="currentColor"
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
