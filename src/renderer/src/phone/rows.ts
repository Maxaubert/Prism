/**
 * The row every list on the phone wears (2026-09-08, owner, after an iPad:
 * "the rows in the file explorer are too small"). They are the thing being
 * pointed at all day, so they are the thing to size first: taller than the
 * 44px floor a button needs, because a LIST is scrolled past as well as
 * tapped, and the name is set at 17px, which is the size a phone's own file
 * list uses. The numbers live in `phone.css`, so the floor is one number in
 * one place rather than a Tailwind size per row; the CLASS lives here for
 * the same reason, now that the folder list and the tab list both wear it.
 */
export const ROW_CLASS =
  'flex min-h-[var(--phone-row)] w-full items-center gap-3 px-4 py-2.5 text-left text-[17px] active:bg-[var(--p-hover)]'
