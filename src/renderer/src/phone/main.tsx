// The shim goes in FIRST: see boot.ts for why it is its own module.
import './boot'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './phone.css'
import { PhoneApp } from './PhoneApp'
import { ArchiveQuestion } from '../components/archive/ArchiveQuestion'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhoneApp />
    <ArchiveQuestion />
  </StrictMode>
)
