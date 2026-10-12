/**
 * The editor's menu: what you get right-clicking text or code (CodeView,
 * anywhere in the editor; also markdown in edit mode and a text member inside
 * an archive). Two variants: the editable one, and a reader's (#106).
 */
import type { MenuItem } from '../../components/ContextMenu'
import type { WrapPref } from '../../lib/codePrefs'
import { fileVerbs } from '../fileVerbs'
import { tickIf } from '../../components/icons/menuGlyphs'

export interface CodeMenuContext {
  path: string
  /** A reader's surface (#106): no verb that changes the document or the file. */
  readOnly: boolean
  /** Whether anything was selected at the moment of the right-click. */
  hasSel: boolean
  /** Whether this file wraps now (the override, or the auto rule for prose). */
  wraps: boolean
  setWrapPref: (v: WrapPref) => void
  /** The editor shows the file it was asked for (not still loading). */
  ready: boolean
  /** The buffer differs from disk. */
  dirty: boolean
  /** Showing only the end of a file too large to load whole. */
  tailed: boolean
  /** Following the file as it grows. */
  following: boolean
  pasteHere: () => void
  selectAll: () => void
  findHere: () => void
  gotoHere: () => void
  toggleFollow: () => void
  save: () => Promise<unknown>
}

/**
 * The editor's own menu (2026-08-30).
 *
 * Right-clicking a selection used to give nothing at all, not even Copy,
 * which reads as a broken text field. CodeMirror renders a contenteditable,
 * so preventing the default here removes Chromium's native menu: this one
 * has to carry the clipboard verbs itself, and it does them through the
 * document APIs rather than by dispatching keystrokes.
 */
export function codeMenu(ctx: CodeMenuContext): MenuItem[] {
  const { path, hasSel, wraps, setWrapPref, ready, dirty, tailed, following } = ctx
  const { selectAll, findHere, gotoHere } = ctx
  // Copy path joins the clipboard verbs and Show in File Explorer closes the
  // menu (owner, 2026-10-12).
  const copyPath = fileVerbs(path).filter((item) => item.label === 'Copy path')
  const elsewhere = fileVerbs(path).filter((item) => item.label !== 'Copy path')
  // A reader's menu (#106) has no Cut, Paste, Follow or Save: those change
  // the document or the file, and it can do neither.
  if (ctx.readOnly)
    return [
      { label: 'Copy', disabled: !hasSel, onPick: () => void document.execCommand('copy') },
      ...copyPath,
      { label: 'Select all', onPick: selectAll },
      { label: 'Find', hint: 'Ctrl+F', onPick: findHere },
      { label: 'Go to line', hint: 'Ctrl+G', onPick: gotoHere },
      {
        label: 'Word wrap',
        icon: tickIf(wraps),
        onPick: () => setWrapPref(wraps ? 'off' : 'on')
      },
      ...elsewhere
    ]
  return [
    // No shortcut hints on the clipboard verbs: Ctrl+X/C/V are the three
    // keys nobody has ever needed a menu to teach them. Find and Save keep
    // theirs, because those are the habits worth having in a viewer that
    // happens to be editable.
    { label: 'Cut', disabled: !hasSel, onPick: () => void document.execCommand('cut') },
    { label: 'Copy', disabled: !hasSel, onPick: () => void document.execCommand('copy') },
    { label: 'Paste', onPick: ctx.pasteHere },
    ...copyPath,
    { label: 'Select all', onPick: selectAll },
    { label: 'Find', hint: 'Ctrl+F', onPick: findHere },
    { label: 'Go to line', hint: 'Ctrl+G', onPick: gotoHere },
    {
      label: 'Word wrap',
      icon: tickIf(wraps),
      // Sets the OVERRIDE, so ticking it off a .txt stops that file
      // wrapping rather than putting the auto rule back.
      onPick: () => setWrapPref(wraps ? 'off' : 'on')
    },
    {
      // A log, a build's output, an agent's transcript: files whose whole
      // point is that they grow. Following is read-only, and refused while
      // there are unsaved edits, which the first chunk would throw away.
      label: 'Follow the file',
      icon: tickIf(following),
      disabled: !ready || dirty || tailed,
      onPick: ctx.toggleFollow
    },
    { label: 'Save', hint: 'Ctrl+S', disabled: following || tailed, onPick: () => void ctx.save() },
    ...elsewhere
  ]
}
