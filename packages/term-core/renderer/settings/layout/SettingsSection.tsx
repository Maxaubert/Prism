import { useId, type JSX, type ReactNode } from 'react'

// A SECTION OF A SETTINGS PAGE (2026-10-05, the grouped cards redesign): a
// heading in sentence case, then ONE panel. The panel is one thin coat of the
// text's own ink over the ground (3.6%), so it reads on glass and on every
// theme without ever becoming a solid slab, and its edge is `--p-line`, which
// the window's Edges setting already drives. Its corners follow the host's
// own roundness, at least 4px.

/** The panel's corner: the host's radius plus 3px, never under 4px. */
export const PANEL_RADIUS = 'rounded-[max(4px,calc(var(--p-radius)_+_3px))]'

export function SettingsSection({
  id,
  title,
  action,
  children
}: {
  /** `data-settings-section`: what the search and the e2e find it by. */
  id: string
  /** The heading. A section with none (the first one of Dictation) has a
   *  label for assistive technology only. */
  title?: string
  /** At the heading's right end: a tag, or Save changes. */
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  const h = useId()
  return (
    <section
      data-settings-section={id}
      aria-labelledby={title ? h : undefined}
      aria-label={title ? undefined : id}
      // 26px apart; the frame puts the first one 18px under the page header.
      className="mt-[26px]"
    >
      {(title || action) && (
        <div className="mx-0.5 mb-2 flex min-h-[18px] items-center gap-3">
          {title && (
            <h3 id={h} className="m-0 text-[13px] font-semibold text-[var(--p-text-soft)]">
              {title}
            </h3>
          )}
          {action && <div className="ml-auto flex items-center">{action}</div>}
        </div>
      )}
      <div
        data-settings-panel
        className={`border border-[color:var(--p-line)] bg-[color-mix(in_srgb,var(--p-text)_3.6%,transparent)] ${PANEL_RADIUS}`}
      >
        {children}
      </div>
    </section>
  )
}

/** A tag for a section heading ("Shared by both apps"): words, not a button. */
export function SectionTag({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="whitespace-nowrap rounded-full border border-[color:var(--p-line)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--p-dim)]">
      {children}
    </span>
  )
}
