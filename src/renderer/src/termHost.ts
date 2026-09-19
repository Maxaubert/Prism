import { configureTermCore } from 'prism-term-core/renderer/host'
import { contrastRatio, ensureContrast, normalizeColor } from 'prism-term-core/renderer/lib/termAnsi'
import { resolveTermTheme } from 'prism-term-core/renderer/lib/termTheme'

/**
 * PRISM AS A HOST OF THE TERMINAL CORE (#154).
 *
 * The terminal is `prism-term-core`, shared with the sibling app Prism
 * Terminal, and every place the two apps legitimately differ is a field here.
 * The owner's rule is that the two terminals are THE SAME ("all should be
 * synced, unless it conflicts with one app"), so a value here differs from
 * Prism Terminal's only where Prism is genuinely a different kind of app: it
 * has app styles, a dock that the terminal lives in, and tabs that are places.
 *
 * A SIDE-EFFECT MODULE, imported FIRST by renderApp.tsx: imports are evaluated
 * in order and before that file's own body, and App's module graph (theme.ts
 * paints at import time) must find a host already there.
 */

const FALLBACK_DONE = '#22c55e'

/** A CSS custom property off :root, flattened to a hex the maths can measure. */
function token(name: string, fallback: string): string {
  try {
    return normalizeColor(getComputedStyle(document.documentElement).getPropertyValue(name).trim(), fallback)
  } catch {
    return fallback
  }
}

configureTermCore({
  api: window.prism,
  defaults: {
    // The terminal wears the app style until the user picks a preset. The ONE
    // default that cannot be shared: "follow the style" only exists where
    // there are styles (owner, 2026-09-19).
    theme: 'style',
    // An acrylic style shows through the terminal by default.
    acrylic: true,
    // MINIMAL, and the ACCENT, as in Prism Terminal (owner, 2026-09-19; it was
    // a filled orange tab). '' = follow the accent, resolved below.
    indicator: 'minimal',
    agentColor: '',
    agentDoneColor: ''
  },
  // Prism HAS styles, publishes them on :root, and the terminal follows them.
  followsHostStyle: true,
  // THE PANEL PAINTS THE GROUND, as in Prism Terminal (owner, 2026-09-19): xterm
  // sizes itself in whole rows, so the strip under the last row was never its
  // to paint. The dock therefore paints NOTHING behind the terminal any more;
  // two translucent coats are a visibly darker panel on an acrylic style.
  paintsGround: true,
  // The tab strip is app chrome, so an unpicked indicator wears the APP STYLE's
  // accent; "finished" is the terminal theme's green, moved until it reads on
  // the strip, and swapped for a plain green if it lands on the accent itself.
  themedAgentColors: (themeId) => {
    const ground = token('--p-side-flat', '#141719')
    const working = ensureContrast(token('--p-accent', '#5b5bd6'), ground, 3)
    const green = ensureContrast(
      normalizeColor(resolveTermTheme(themeId).green ?? '', FALLBACK_DONE),
      ground,
      3
    )
    const finished = contrastRatio(green, working) < 1.15 ? ensureContrast(FALLBACK_DONE, ground, 3) : green
    return { working, finished }
  },
  // The window's material belongs to the app STYLE here, so the terminal row
  // only decides whether the terminal lets it show through, and there is no
  // opacity slider: two alphas over one sheet of glass would fight (owner).
  acrylic: { kind: 'style' },
  ownsKey: (e) => {
    if (!e.ctrlKey || e.altKey) return false
    // Find in the scrollback: with SHIFT, so the shell keeps plain Ctrl+F.
    if (e.shiftKey && (e.key === 'f' || e.key === 'F')) return true
    // Tab management works over a focused shell: Ctrl+Tab, Ctrl+T / W / B
    // (any shift), Ctrl+1-9. Ctrl+W closing a tab is the same in both apps.
    if (e.key === 'Tab' || /^[twb]$/i.test(e.key) || /^[1-9]$/.test(e.key)) return true
    // Ctrl+` is Prism's too (it shows and hides the panel). Left to xterm it
    // became a NUL byte to the pty, which counted as TYPING (#99).
    return e.key === '`'
  }
})
