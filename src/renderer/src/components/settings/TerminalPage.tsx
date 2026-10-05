import type { JSX } from 'react'
import { ShellSection } from 'prism-term-core/renderer/settings/sections/ShellSection'
import { TerminalTextSection } from 'prism-term-core/renderer/settings/sections/TerminalTextSection'
import { TerminalThemeSection } from 'prism-term-core/renderer/settings/sections/TerminalThemeSection'

/**
 * TERMINAL: THE CORE'S SECTIONS, AND NOTHING ELSE (#154; 2026-10-05, the
 * grouped cards redesign). Every option, its name, type and behaviour, is the
 * same code here and in Prism Terminal (owner, 2026-09-19: "the setting names,
 * types, how they function and so on should be the same"); only the personal
 * VALUES differ. Prism's window wears its own style, so the terminal theme is
 * this page's (Q2), with no rows of the window's under the wall. No command
 * help (owner, 2026-09-22: it is Prism Terminal's). `data-terminal-settings`
 * is what the gate's `termOptions` reads.
 */
export function TerminalPage(): JSX.Element {
  return (
    <div data-terminal-settings>
      <ShellSection />
      <TerminalTextSection />
      <TerminalThemeSection />
    </div>
  )
}
