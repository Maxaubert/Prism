/**
 * The markdown reader's menu: what you get right-clicking a rendered markdown
 * document (MarkdownView, anywhere on the page).
 */
import type { MenuItem } from '../../components/ContextMenu'
import { fileVerbs } from '../fileVerbs'

export interface MarkdownMenuContext {
  path: string
  /** Opens the find bar, as Ctrl+F does. */
  find: () => void
}

export function markdownMenu(ctx: MarkdownMenuContext): MenuItem[] {
  return [{ label: 'Find', hint: 'Ctrl+F', onPick: () => ctx.find() }, ...fileVerbs(ctx.path)]
}
