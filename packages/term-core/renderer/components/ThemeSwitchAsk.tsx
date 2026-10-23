import type { JSX } from 'react'
import { Modal } from './Modal'
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
  return (
    <Modal
      shadow={false}
      onCancel={onCancel}
      role="alertdialog"
      labelledBy="theme-switch-ask-title"
      describedBy="theme-switch-ask-body"
      focus="[data-ask-save]"
      scrimAttrs={{ 'data-theme-switch-ask': true }}
      boxClassName="w-full max-w-[420px] p-5"
    >
      <h2 id="theme-switch-ask-title" className="text-[14.5px] font-semibold text-[var(--p-text)]">
        Save your changes first?
      </h2>
      <p
        id="theme-switch-ask-body"
        className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--p-dim)]"
      >
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
          data-ask-save
          className="h-8 rounded-[var(--p-radius-sm)] bg-[var(--p-accent)] px-3 text-[12px] font-semibold text-[var(--p-on-accent)] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
          onClick={onSave}
        >
          Save as Custom
        </button>
      </div>
    </Modal>
  )
}
