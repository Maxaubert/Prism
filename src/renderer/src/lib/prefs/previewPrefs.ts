import { createPref } from './createPref'

// WHERE THE EXPLORER'S PREVIEW OPENS (owner, 2026-11-08: "build a setting to
// have a preview which opens as a separate window. just like apple does it,
// space opens and closes that too"). Settings > Explorer > Layout > Preview
// opens in. The panel beside the list (default, as it always was) or a window
// of its own over the Explorer, Quick Look style (`PreviewWindow.tsx`,
// `src/main/previewWindow.ts`). Space, the toolbar's preview button and a file
// from Windows open whichever is chosen.

export type PreviewOpensIn = 'panel' | 'window'

/** Anything but 'window' (unset, junk, an unreadable store) is the panel. */
export function previewOpensInOf(raw: unknown): PreviewOpensIn {
  return raw === 'window' ? 'window' : 'panel'
}

const pref = createPref<PreviewOpensIn>({
  key: 'prism.preview.opens',
  read: 'always',
  // Another window's choice arrives as a storage event (windowPreferences).
  live: true,
  parse: previewOpensInOf,
  fallback: 'panel'
})

export const previewOpensIn = pref.get
export const setPreviewOpensIn = (v: PreviewOpensIn): void => pref.set(previewOpensInOf(v))
export const usePreviewOpensIn = pref.use
