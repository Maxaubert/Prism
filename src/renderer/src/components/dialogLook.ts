/**
 * The look, in one place (2026-09-19, #166): the extraction window is a
 * dialog that cannot be dismissed, so it cannot BE this component (whose
 * whole contract is that Escape and a click outside cancel), but it has to
 * look like one. Shared strings rather than a copy, so the two cannot drift,
 * and in a file of their own because a component file that also exports
 * constants loses fast refresh.
 */
export const DIALOG_SCRIM = 'fixed inset-0 z-50 grid place-items-center bg-black/55 p-6'
// Flat surface colour: --p-title carries the window alpha on glass styles,
// and a question box should not be see-through.
export const DIALOG_BOX =
  'w-full max-w-[420px] rounded-[var(--p-radius)] border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.6)]'
export const DIALOG_TITLE = 'text-[14.5px] font-semibold text-[var(--p-text)]'
export const DIALOG_BODY = 'mt-1.5 text-[12.5px] leading-relaxed text-[var(--p-dim)]'
export function dialogButton(c: { primary?: boolean; danger?: boolean }): string {
  return `rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] ${
    c.danger
      ? 'bg-[#b4353f] text-[var(--p-on-accent)] hover:brightness-110'
      : c.primary
        ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:brightness-110'
        : 'border border-[color:var(--p-divider)] bg-[var(--p-hover)] text-[var(--p-text-soft)] hover:text-[var(--p-text)]'
  }`
}
