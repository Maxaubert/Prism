import { configureTermCore } from 'prism-term-core/renderer/host'

/**
 * PRISM AS A HOST OF THE TERMINAL CORE (#154).
 *
 * The terminal is `prism-term-core`, shared with the sibling app Prism
 * Terminal, and every place the two apps legitimately differ is a field here.
 * EACH VALUE BELOW IS WHAT PRISM ALREADY DID before it adopted the core, on
 * purpose: taking the core must not change what an existing user sees. Where
 * the owner later picks one answer for both apps, the field changes here and
 * in Prism Terminal's host file, and the difference is gone.
 *
 * A SIDE-EFFECT MODULE, imported FIRST by main.tsx: imports are evaluated in
 * order and before main.tsx's own body, and App's module graph (theme.ts
 * paints at import time) must find a host already there.
 */
configureTermCore({
  api: window.prism,
  defaults: {
    // The terminal wears the app style until the user picks a preset.
    theme: 'style',
    // An acrylic style shows through the terminal by default.
    acrylic: true,
    // The whole tab fills while an agent works.
    indicator: 'full',
    agentColor: '#f97316',
    agentDoneColor: '#22c55e'
  },
  // Prism HAS styles, publishes them on :root, and the terminal follows them.
  followsHostStyle: true,
  // The dock paints --p-bg behind the panel; a second coat from the panel is
  // a visibly darker terminal than the rest of an acrylic window.
  paintsGround: false,
  ownsKey: (e) => {
    if (!e.ctrlKey || e.altKey) return false
    // Find in the scrollback: with SHIFT, so the shell keeps plain Ctrl+F.
    if (e.shiftKey && (e.key === 'f' || e.key === 'F')) return true
    // Tab management works over a focused shell: Ctrl+Tab, Ctrl+T / W / B
    // (any shift), Ctrl+1-9.
    if (e.key === 'Tab' || /^[twb]$/i.test(e.key) || /^[1-9]$/.test(e.key)) return true
    // Ctrl+` is Prism's too (it shows and hides the panel). Left to xterm it
    // became a NUL byte to the pty, which counted as TYPING (#99).
    return e.key === '`'
  }
})
