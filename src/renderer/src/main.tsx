import './lib/windowPreferences'
import { noteDiagBackground, startDiag } from 'prism-term-core/renderer/lib/diag'
import { watchSweepOverlay } from './hooks/sweepOverlayState'
import { readStored } from './lib/storage'

// THE PAGE'S HALF OF THE DIAGNOSTICS LOG (#322): long frames, errors, the
// heartbeat main watches, and the crumbs the app says. First thing in the
// small entry, so a stall while the app chunk evaluates or App mounts is
// caught too; it pulls in no React and nothing heavy.
startDiag(window.prism)
// Minimised, the beat and the batch slow down (perf review, 2026-10-28): the
// window is never throttled, so nothing else would. Main says it (the page
// cannot see a minimise) and slows its own watch to match.
window.prism.onWindowState((st) => noteDiagBackground(st.minimised))
// The native sweep box's state (#338): main says it once, shortly after the
// first paint, and again on each change; listening from here, it is never missed.
watchSweepOverlay()

// This entry stays small so the existing window can paint before React and the
// viewers load. Window controls work during that wait, including a slow disk.
document.getElementById('boot-minimize')?.addEventListener('click', () => window.prism.minimize())
document.getElementById('boot-maximize')?.addEventListener('click', () => window.prism.toggleMaximize())
document.getElementById('boot-close')?.addEventListener('click', () => window.prism.close())
// theme.ts keeps `prism.mode`; it is read raw here so this entry stays small.
// A blocked preference store reads as unset and must not stop the window opening.
if (readStored('prism.mode') === 'light') document.documentElement.dataset.bootMode = 'light'

// Give the browser a paint opportunity before evaluating the heavier app chunk.
requestAnimationFrame(() => {
  setTimeout(() => {
    performance.mark('prism-boot-visible')
    void import('./renderApp').catch(() => {
      const status = document.getElementById('boot-status')
      if (status) status.textContent = 'Prism could not finish opening. Close this window and try again.'
    })
  }, 0)
})
