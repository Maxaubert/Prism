import { useEffect, useRef, type JSX } from 'react'
import { ROW_BUTTON } from '../settings/fields'
import { acrylicWord } from '../settings/sections/opts'

/**
 * UNSAVED CHANGES ASK BEFORE A THEME SWITCH (owner, 2026-09-23: "if you have
 * altered some settings like font or anything that would make it so you have
 * to save you should get prompted on theme change"). Picking a theme returns
 * the look to that theme's own defaults, which used to throw away an unsaved
 * font, size, agent colour or acrylic change in silence. Shown only while Save
 * changes is lit; with nothing unsaved a pick just switches.
 *
 * Three answers: Save as Custom (the accent, as every save is: #42), Discard,
 * Cancel. Escape and a press outside are Cancel. Props only; both apps show it
 * from the core's appearance settings.
 */
export default function ThemeSwitchAsk({
  onSave,
  onDiscard,
  onCancel
}: {
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}): JSX.Element {
  const save = useRef<HTMLButtonElement>(null)
  // Registered ONCE (code review 2026-09-24, #22). Keyed on an inline
  // onCancel, every render of the settings page re-ran this: the focus jumped
  // back to Save from wherever Tab had taken it (Enter then saved instead of
  // discarding), and the listener was torn down and put back, the race
  // UpdateDialog measured as an Escape that did nothing. The latest onCancel
  // is read through a ref.
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  })
  useEffect(() => {
    save.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel.current()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  return (
    <div
      data-theme-switch-ask
      data-owns-escape
      className="no-drag fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="theme-switch-ask-title"
        aria-describedby="theme-switch-ask-body"
        className="w-full max-w-[420px] rounded-[var(--p-radius)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] p-5"
      >
        <h2 id="theme-switch-ask-title" className="text-[14.5px] font-semibold text-[var(--p-text)]">
          Save your changes first?
        </h2>
        <p id="theme-switch-ask-body" className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--p-dim)]">
          Switching theme puts the agent colours and {acrylicWord()} back to the new theme&apos;s own.
          Your changes are not saved yet.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button data-ask-cancel className={ROW_BUTTON} onClick={onCancel}>
            Cancel
          </button>
          <button data-ask-discard className={ROW_BUTTON} onClick={onDiscard}>
            Discard
          </button>
          <button
            ref={save}
            data-ask-save
            className="h-8 rounded-[var(--p-radius-sm)] bg-[var(--p-accent)] px-3 text-[12px] font-semibold text-[var(--p-on-accent)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
            onClick={onSave}
          >
            Save as Custom
          </button>
        </div>
      </div>
    </div>
  )
}
