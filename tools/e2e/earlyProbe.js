/**
 * E2E ONLY: the never-a-loading-screen probe, from before the page's first
 * script (review of #271). The harness's own probe goes in after
 * `domcontentloaded`, by which time the module script, and perhaps React's
 * first render, have run, so a loading line drawn and removed before then
 * was never seen. Main registers this file as a frame preload when the e2e
 * hands it over (`PRISM_E2E_EARLY_PROBE`), so it runs as the document is made.
 *
 * It runs in the preload's isolated world, which shares the DOM and nothing
 * else, so what it saw is written where the harness can read it: the
 * `data-nl-early` attribute of <html>, a JSON list. `installed` proves it ran.
 */
/* global document, MutationObserver */
;(() => {
  const bad = /Loading folder|Loading…|Opening Prism/
  const state = { installed: true, seen: [] }
  let written = ''
  const save = () => {
    const root = document.documentElement
    if (!root) return
    const text = JSON.stringify(state)
    if (text !== written) root.setAttribute('data-nl-early', (written = text))
  }
  const look = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement
    if (!el || el.closest('style,script,head')) return
    const text = node.nodeType === 3 ? node.data : el.textContent
    if (text && bad.test(text)) state.seen.push(text.trim().slice(0, 80))
    // The boot shell is silent: its status line speaks only for a failed start.
    const status = document.getElementById('boot-status')
    if (status && status.textContent.trim() && !state.seen.includes('boot-status'))
      state.seen.push('boot-status')
  }
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') look(r.target)
      for (const n of r.addedNodes) look(n)
    }
    save()
  }).observe(document, { subtree: true, childList: true, characterData: true })
  if (document.documentElement) look(document.documentElement)
  save()
})()
