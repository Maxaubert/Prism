// The shim goes in FIRST: see boot.ts for why it is its own module.
import './boot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { PhoneApp } from './PhoneApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>
)
