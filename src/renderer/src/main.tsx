import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Recording hook, off unless --demo was passed. The showcase needs the window to
// change its look mid-playback, and driving that through Settings would put the
// settings panel over the very thing being shown. Two setters, no more.
if (window.prism.demo) {
  void Promise.all([import('./lib/theme'), import('./lib/vizStore')]).then(([theme, viz]) => {
    ;(window as unknown as { prismDemo: unknown }).prismDemo = {
      setStyle: theme.setStyle,
      setMode: theme.setMode,
      // A visualizer is a PRESET, not a shape: each one carries its own height,
      // position, width and palette, and the grounded ones sit low on purpose.
      // Setting the shape alone leaves the previous geometry behind, which makes
      // Halo render at Caps's height and the bars render where a ring belongs.
      // This is the same call a click in Settings makes.
      setPreset: (name: string) => {
        const found = viz
          .vizState()
          .presets.find((p) => p.id === name || p.name.toLowerCase() === name.toLowerCase())
        if (!found) throw new Error(`no visualizer preset called ${name}`)
        viz.applyPreset(found)
      },
      listPresets: () => viz.vizState().presets.map((p) => ({ id: p.id, name: p.name })),
      setViz: viz.setStyle,
      setVizTheme: viz.setTheme,
      setVizGlow: viz.setGlow
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
