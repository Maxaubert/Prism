import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Recording hook, off unless --demo was passed. The showcase needs the window to
// change its look mid-playback, and driving that through Settings would put the
// settings panel over the very thing being shown. Two setters, no more.
if (window.prism.demo) {
  void import('./lib/theme').then((theme) => {
    ;(window as unknown as { prismDemo: unknown }).prismDemo = {
      setStyle: theme.setStyle,
      setMode: theme.setMode
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
