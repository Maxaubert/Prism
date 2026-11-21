/**
 * The look of a dialog's CONTENT, in one place (2026-09-19, #166): the box, the title,
 * the body and the buttons. The frame around it (scrim, Escape, Tab, focus) is the
 * core's Modal for every dialog, the extraction window included (#513). The look
 * lives in the core too (#514), so the update window and the stop controls wear
 * the same buttons. In a file of their own because a component file that also
 * exports constants loses fast refresh.
 */
// THE BOX takes its width and padding as options (#514): a class string patched
// with .replace() breaks silently the day its text changes. Tailwind reads whole
// class names, so every size is a literal in these two tables.
const BOX_WIDTH = {
  420: 'max-w-[420px]',
  456: 'max-w-[456px]',
  520: 'max-w-[520px]',
  580: 'max-w-[580px]'
} as const
const BOX_PAD = { normal: 'p-5', sheet: 'px-[22px] py-5', roomy: 'p-7' } as const

export type DialogBoxOptions = {
  /** The widest the box grows, in px. Default 420. */
  width?: keyof typeof BOX_WIDTH
  /** `sheet` is the progress sheet's 22px sides, `roomy` the drive window's. */
  pad?: keyof typeof BOX_PAD
}

// Flat surface colour: --p-title carries the window alpha on glass styles,
// and a question box should not be see-through.
//
// `relative` IS FOR A MAGNIFIER (owner, 2026-11-10: "the caret dont seem to be
// tracked in the input field"). Measured through UI Automation (e2e
// `caretTracks`, tools/e2e/uiaCaret.ps1): a text field in a box that is not
// positioned, itself inside the centring scrim, answers TextPattern.
// GetSelection() with a caret that has NO rectangle, so a magnifier has
// nothing to follow; the same field in a positioned box answers a thin bar
// that moves with every key. Chromium's, so the box carries the fix.
export function dialogBox(o: DialogBoxOptions = {}): string {
  return `relative w-full ${BOX_WIDTH[o.width ?? 420]} max-h-[calc(100vh-3rem)] overflow-y-auto rounded-[var(--p-radius)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] ${BOX_PAD[o.pad ?? 'normal']} shadow-[0_24px_70px_rgba(0,0,0,.6)]`
}
export const DIALOG_BOX = dialogBox()
export const DIALOG_TITLE = 'break-words text-[14.5px] font-semibold text-[var(--p-text)]'
export const DIALOG_BODY = 'mt-1.5 break-words text-[12.5px] leading-relaxed text-[var(--p-dim)]'
// A name or a path inside a question's body, a step brighter than the line.
export const DIALOG_EMPHASIS = 'text-[var(--p-text)]'

// THE ONE TEXT FIELD OF A DIALOG (#516): the password field's look, which the
// rename and search fields now wear too. The caller adds its own margin.
export const DIALOG_INPUT =
  'w-full rounded border border-[color:var(--p-divider)] bg-[var(--p-bg)] px-2 py-1.5 text-[12.5px] text-[var(--p-text)] outline-none focus:border-[color:var(--p-accent-hi)]'

export type DialogButton = {
  /** The app's accent: the act of the question. */
  primary?: boolean
  /** Red: overwriting, deleting. */
  danger?: boolean
  /** The accent of a chosen thing (--p-sel-bg), as the progress card's Open. */
  selected?: boolean
  /** The inline control in a row (Compute, Cancel), not a dialog's footer. */
  compact?: boolean
}

// ONE BUTTON for every dialog, the update window and the stop controls (#514).
// No focus ring (#272; owner, 2026-10-04: "go through the ui and remove focus
// effects like this"): a focused button looks as it does under the pointer.
// A disabled one is 45 percent, shows no pointer and ignores hover.
export function dialogButton(c: DialogButton): string {
  const size = c.compact ? 'px-2.5 py-1 leading-none' : 'px-3.5 py-1.5'
  return `rounded-lg ${size} text-[12.5px] font-semibold transition-colors focus-visible:outline-none disabled:cursor-default disabled:opacity-45 ${
    c.danger
      ? 'bg-[#b4353f] text-[var(--p-on-accent)] hover:brightness-110 focus-visible:brightness-110 disabled:hover:brightness-100'
      : c.selected
        ? 'bg-[var(--p-sel-bg)] text-[var(--p-on-accent)] hover:brightness-110 focus-visible:brightness-110 disabled:hover:brightness-100'
        : c.primary
          ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:brightness-110 focus-visible:brightness-110 disabled:hover:brightness-100'
          : 'border border-[color:var(--p-divider)] bg-[var(--p-hover)] text-[var(--p-text-soft)] hover:text-[var(--p-text)] focus-visible:text-[var(--p-text)] disabled:hover:text-[var(--p-text-soft)]'
  }`
}
