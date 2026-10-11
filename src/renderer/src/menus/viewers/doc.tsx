/**
 * The document reader's menu: what you get right-clicking an office or ebook
 * document shown as a sheet (DocView, anywhere on the page or the canvas).
 */
import type { MenuItem } from '../../components/ContextMenu'
import { fileVerbs } from '../fileVerbs'

export interface DocMenuContext {
  path: string
  /** Opens the find bar, as Ctrl+F does. */
  find: () => void
}

export function docMenu(ctx: DocMenuContext): MenuItem[] {
  const { path } = ctx
  return [
    { label: 'Find', hint: 'Ctrl+F', onPick: () => ctx.find() },
    // The honest escape hatch: this is a READING view, with no layout
    // fidelity and no editing, so the app that made the file is one row
    // away rather than a thing to go and hunt for.
    { label: 'Open in default app', onPick: () => window.prism.openInDefault(path) },
    ...fileVerbs(path)
  ]
}
