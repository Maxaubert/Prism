/**
 * THE OVERLAY LAYERS, BOTTOM TO TOP, in one place (audit 2026-10-12: the
 * numbers were spread over a dozen files, so the order could only be read by
 * collecting them). Whole Tailwind classes, so the build sees each one.
 *
 * - panel: what lies over the terminal and the page (the find bar, the
 *   dictation pill, the tab sidebar).
 * - pop: a small popup anchored to a control (a dropdown, the update chip's tip).
 * - menu: a right-click menu, over every panel and popup.
 * - picker: the colour picker opened outside any dialog, just under a dialog.
 * - modal: a dialog (Modal), over everything the app draws.
 * - toast: the "Copied" badge, which must show even over a dialog.
 */
export const LAYER = {
  panel: 'z-30',
  pop: 'z-40',
  menu: 'z-[45]',
  picker: 'z-[49]',
  modal: 'z-50',
  toast: 'z-[300]'
} as const
