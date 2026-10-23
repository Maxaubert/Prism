import type { SettingsSectionId } from './sectionIds'

/**
 * THE TAB MARKS' OWN OPTIONS (#143), the deal `options.ts` makes for the
 * terminal's rows: each renders as `data-pref="<id>"`, and each app's e2e
 * asserts its page shows this list where its host draws the marks.
 *
 * A list of its own rather than rows in `TERMINAL_OPTIONS`, for the reason
 * `helpOptions.ts` gave: Prism's gate reads THAT file as text and its unit test
 * orders every id in it, so a row added there would turn Prism red at the next
 * core bump although Prism's strip does not draw the rainbow. A row here is
 * drawn only where the host declares it (`tabMarks.rainbow`).
 */
export interface MarkOption {
  id: string
  label: string
  type: 'switch'
  key: string
  section: SettingsSectionId
  icon: string
  sub: string
  keywords?: string
}

export const MARK_OPTIONS: readonly MarkOption[] = [
  { id: 'agent-rainbow', label: 'Rainbow finished mark', type: 'switch', key: 'prism.term.agentRainbow', section: 'marks', icon: 'rainbow', sub: 'The colours of the app icon, flowing.', keywords: 'colors gradient finished done icon' }
]
