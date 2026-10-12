import type { TabState } from './tabs'

/**
 * WHAT THE TAB STRIP DID, FOR THE DIAGNOSTICS LOG (#322): the crumbs between
 * two tab states. Read off the state rather than said at each call site, since
 * a tab is opened, closed or switched to from a dozen places (keys, the strip,
 * a handoff, a restore, Explorer verbs) and one missed site is a hole in the
 * timeline. Pure, so App says what this returns and nothing else.
 *
 * - `tab-open` / `tab-close`, with the tab's kind and root.
 * - `tab-switch`: another tab in front.
 * - `project-open`: a project tab opened, or a project tab's root changed.
 * - `player-open`: a tab's current file became a video or a sound. Detailed
 *   logging's only (`often`) while the Explorer shows it in the preview pane
 *   beside the list: there every row the selection lands on opens, so holding
 *   Down through a music folder was a line per row (review of #322).
 */
export interface TabCrumb {
  a: string
  fields: Record<string, unknown>
  often?: boolean
}

const kindOf = (t: TabState['tabs'][number]): string => t.kind ?? t.role ?? 'project'

function playing(t: TabState['tabs'][number]): { path: string; kind: string } | null {
  const f = t.files[t.index]
  return f && (f.kind === 'video' || f.kind === 'audio') ? { path: f.path, kind: f.kind } : null
}

export function tabCrumbs(prev: TabState, next: TabState): TabCrumb[] {
  if (prev === next) return []
  const out: TabCrumb[] = []
  const before = new Map(prev.tabs.map((t) => [t.id, t]))
  const after = new Set(next.tabs.map((t) => t.id))
  for (const t of next.tabs) {
    const was = before.get(t.id)
    const kind = kindOf(t)
    if (!was) {
      out.push({ a: 'tab-open', fields: { id: t.id, kind, root: t.root || null } })
      if (kind === 'project') out.push({ a: 'project-open', fields: { id: t.id, root: t.root } })
    } else if (kind === 'project' && was.root !== t.root) {
      out.push({ a: 'project-open', fields: { id: t.id, root: t.root } })
    }
    const now = playing(t)
    const then = was ? playing(was) : null
    if (now && now.path !== then?.path)
      out.push({
        a: 'player-open',
        fields: { id: t.id, ...now },
        ...(t.browse.surface !== 'viewer' && t.browse.preview ? { often: true } : {})
      })
  }
  for (const t of prev.tabs)
    if (!after.has(t.id)) out.push({ a: 'tab-close', fields: { id: t.id, kind: kindOf(t) } })
  if (next.activeId && next.activeId !== prev.activeId && before.has(next.activeId))
    out.push({ a: 'tab-switch', fields: { id: next.activeId } })
  return out
}
