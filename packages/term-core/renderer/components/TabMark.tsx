import type { JSX } from 'react'
import type { MarkState, TabMark as Mark } from '../lib/tabMark'
import { motionClass } from './markClasses'

/**
 * A TAB'S AGENT MARK, on a flat tab (#143). Props only: the strip asks
 * `resolveTabMark` WHAT to draw and resolves its colour; this draws it.
 *
 * - `run`: the working bar running along the foot.
 * - `line`: a 3 px line along the foot (finished, question, failed).
 * - `ring`: an inline element the strip puts beside the name, mono (#162):
 *   the spinner while working, a check, a breathing dot or a cross.
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
      // A FLOWING rainbow is an inner layer the line clips, moved by a
      // transform (perf review 2026-10-16, styles/marks.css): sliding the
      // line's own background was a paint every frame.
      if (mark.motion === 'flow')
        return (
          <span {...common} className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[3px] overflow-hidden">
            <span className={motionClass(mark.motion, 'x')} style={{ background, backgroundSize: '114px 100%' }} />
          </span>
        )
      return (
        <span
          {...common}
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[3px] ${motionClass(mark.motion, 'x')}`}
          style={{ background }}
        />
      )
    case 'ring':
      // MONO (#162): every state's glyph in the name's own ink (currentColor),
      // one 12 px slot, so a name never moves when its state changes.
      return (
        <span
          {...common}
          data-ring={state ?? undefined}
          className="pointer-events-none relative z-[2] -mr-0.5 grid h-3 w-3 shrink-0 place-items-center"
        >
          {state === 'working' ? (
            <span
              className="p-mark-spin block h-3 w-3 rounded-full border-2 border-[color-mix(in_srgb,currentColor_24%,transparent)] border-t-current"
              style={{ ['--mark-c' as string]: 'currentColor' }}
            />
          ) : state === 'question' ? (
            <span className={`block h-[7px] w-[7px] rounded-full bg-current ${motionClass(mark.motion)}`} />
          ) : state === 'done' ? (
            <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.2 8.6l3 3 6.6-7.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          )}
        </span>
      )
    case 'fill': {
      // A FLOWING rainbow is an inner layer the fill clips, moved by a
      // transform (perf review 2026-10-16), as the line's.
      const flow = mark.motion === 'flow'
      return (
        <span
          {...common}
          className={`pointer-events-none absolute inset-0 z-0 ${flow ? 'overflow-hidden' : motionClass(mark.motion, 'fill')}`}
          style={{
            ...(flow ? {} : { background }),
            ...(ink ? { ['--mark-ink' as string]: ink } : {})
          }}
        >
          {/* The `background` shorthand resets the class's size, so the
              flowing rainbow's tile (228 px, two tabs) is said again here. */}
          {flow && (
            <span className={motionClass(mark.motion, 'fill')} style={{ background, backgroundSize: '228px 100%' }} />
          )}
          {/* Minimal's own run, on top of the fill: the run case's markup. */}
          {mark.overlay === 'run' && overlay && (
            <span data-mark-overlay="run" className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden">
              <span className="p-agent-run absolute inset-y-0 w-[42%] rounded-full" style={{ background: overlay }} />
            </span>
          )}
        </span>
      )
    }
    default:
      return null
  }
}
