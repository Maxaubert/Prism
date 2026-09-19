import './lib/windowPreferences'

// This entry stays small so the existing window can paint before React and the
// viewers load. Window controls work during that wait, including a slow disk.
document.getElementById('boot-minimize')?.addEventListener('click', () => window.prism.minimize())
document.getElementById('boot-maximize')?.addEventListener('click', () => window.prism.toggleMaximize())
document.getElementById('boot-close')?.addEventListener('click', () => window.prism.close())
try {
  if (localStorage.getItem('prism.mode') === 'light')
    document.documentElement.dataset.bootMode = 'light'
} catch {
  // A blocked preference store must not prevent the window from opening.
}

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
