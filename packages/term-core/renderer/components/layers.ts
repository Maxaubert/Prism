/**
 * THE OVERLAY LAYERS, BOTTOM TO TOP, in one place (audit 2026-10-12: the
 * numbers were spread over a dozen files, so the order could only be read by
 * collecting them). Whole Tailwind classes, so the build sees each one.
 *
 * - panel: what lies over the page (the find bar, the tab
 *   strip's overlays).
 * - pop: a small popup anchored to a control (a dropdown, the update chip's tip).
 * - menu: a right-click menu, over every panel and popup.
 * - picker: the colour picker opened outside any dialog, just under a dialog.
 * - modal: a dialog (Modal), over everything the app draws.
 * - busy: the app's one window that cannot be dismissed (Prism's extraction), over a dialog.
 * - toast: the "Copied" badge, which must show even over a dialog.
 * - tip: a tooltip (Tooltips), over everything: it names what the pointer is on.
 */
export const LAYER = {
  panel: 'z-30',
  pop: 'z-40',
  menu: 'z-[45]',
  picker: 'z-[49]',
  modal: 'z-50',
  busy: 'z-[90]',
  toast: 'z-[300]',
  tip: 'z-[310]'
} as const

/** The one scrim behind a dialog: a black tint and a light blur. --p-scrim is the tint,
 *  so a popup that draws its own scrim (Prism's search popup) takes the same one. A whole
 *  Tailwind class string, so the build sees it. */
export const SCRIM = 'bg-[var(--p-scrim,rgb(0_0_0/0.5))] backdrop-blur-[2px]'
