/**
 * "Is this the fullscreen key?" in one place (owner, 2026-11-04: "clicking
 * ctrl f on a preview sometimes opens fullscreen and sometimes opens the find
 * tool like it should. like pdf it opens fullscreen").
 *
 * The viewers (image, PDF, the media transport) each read `e.key === 'f'` and
 * nothing else, and Ctrl+F reports the same key. So Ctrl+F toggled fullscreen
 * wherever nobody had claimed it first: on a picture or a film in the
 * preview, and over a PDF preview whenever a picture was warm in another tab.
 * The fullscreen key is the BARE F: no Ctrl, Alt or Meta (Shift is still F,
 * Caps Lock gives 'F'). Every viewer asks this, never `e.key` alone.
 */
export function isFullscreenKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return (e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey && !e.metaKey
}
