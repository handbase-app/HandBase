import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { startSync } from './sync.ts'
import { startPresence } from './presence.ts'
import { applyTheme } from './theme.ts'
import { startPwaUpdates } from './pwa.ts'

// Couleurs du thème choisi, avant le premier affichage (pas de flash).
applyTheme()
startSync()
startPresence()
startPwaUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthGate>
        <App />
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
)
