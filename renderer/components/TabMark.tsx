import type { JSX } from 'react'
import type { MarkState, TabMark as Mark } from '../lib/tabMark'
import { motionClass } from './markClasses'

/**
 * A TAB'S AGENT MARK, on a flat tab (#143). Props only: the strip asks
 * `resolveTabMark` WHAT to draw and resolves its colour; this draws it.
 *
 * - `run`: the working bar running along the foot.
 * - `line`: a 3 px line along the foot (finished, question, failed).
 * - `ring`: the spinner, an inline element the strip puts beside the name.
 * - `fill`: the whole tab, solid, under the name (Full, a tab not in front);
 *   a rainbow finish flows across all of it. With an `overlay` of `run`,
 *   Minimal's running bar on top in the `overlay` colour (the name's ink,
 *   owner, 2026-10-10). A Prompt fill has none: its edge is the host's.
 * - `edge`: a Prompt segment's arrow edge, which the host's Prompt strip draws
 *   itself; nothing here.
 *
 * Every element is `aria-hidden` and lets the pointer through; the tab's own
 * attributes say its state to tests and to nobody else.
 */
export function TabMark({
  mark,
  state,
  background,
  overlay,
  ink
}: {
  mark: Mark
  state: MarkState | null
  /** The mark's colour, or the rainbow's gradient. */
  background: string
  /** The colour of the working mark drawn on a working fill (`markPalette`'s
   *  `overlay.run`). */
  overlay?: string
  /** The name's ink on a fill, chosen once per state colour (`nameInk`). */
  ink?: string
}): JSX.Element | null {
  const attention = state && state !== 'working' ? state : undefined
  const rainbow = mark.colour === 'rainbow' ? '' : undefined
  const common = {
    'data-mark': mark.place,
    'data-mark-motion': mark.motion ?? undefined,
    'data-attention': attention,
    'data-rainbow': rainbow,
    'aria-hidden': true
  }
  switch (mark.place) {
    case 'run':
      return (
        <span {...common} className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[3px] overflow-hidden">
          <span className="p-agent-run absolute inset-y-0 w-[42%] rounded-full" style={{ background }} />
        </span>
      )
    case 'line':
      return (
        <span
          {...common}
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[3px] ${motionClass(mark.motion, 'x')}`}
          style={{ background, ...(mark.motion === 'flow' ? { backgroundSize: '114px 100%' } : {}) }}
        />
      )
    case 'ring':
      return (
        <span
          {...common}
          className="p-mark-spin pointer-events-none relative z-[2] -mr-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2 border-[color-mix(in_srgb,var(--p-text)_24%,transparent)]"
          style={{ borderTopColor: background, ['--mark-c' as string]: background }}
        />
      )
    case 'fill':
      return (
        <span
          {...common}
          className={`pointer-events-none absolute inset-0 z-0 ${motionClass(mark.motion, 'fill')}`}
          // The `background` shorthand resets the class's size, so the flowing
          // rainbow's tile (228 px, two tabs) is said again here.
          style={{
            background,
            ...(mark.motion === 'flow' ? { backgroundSize: '228px 100%' } : {}),
            ...(ink ? { ['--mark-ink' as string]: ink } : {})
          }}
        >
          {/* Minimal's own run, on top of the fill: the run case's markup. */}
          {mark.overlay === 'run' && overlay && (
            <span data-mark-overlay="run" className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden">
              <span className="p-agent-run absolute inset-y-0 w-[42%] rounded-full" style={{ background: overlay }} />
            </span>
          )}
        </span>
      )
    default:
      return null
  }
}
