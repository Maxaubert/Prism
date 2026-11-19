import type { JSX } from 'react'
import { toastStore } from '../lib/say'

/** THE ONE TOAST (#517): what a quick action says ("Image copied", "Undid
 *  moving a.txt"), quietly and briefly at the bottom. Mounted once, in App;
 *  `say(text)` shows it and times it (lib/sayCore). Nothing to answer, so
 *  never a dialog, and it never takes a click. */
export function Toast(): JSX.Element | null {
  const toast = toastStore.use()
  if (!toast) return null
  return (
    <div
      role="status"
      data-toast
      className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-3.5 py-1.5 text-[12px] text-[var(--p-text-soft)] shadow-[0_10px_28px_rgba(0,0,0,.45)]"
    >
      {toast.text}
    </div>
  )
}