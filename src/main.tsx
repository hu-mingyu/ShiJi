import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'

if (Capacitor.isNativePlatform()) {
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
  )

  document.addEventListener('gesturestart', (event) => event.preventDefault())
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) event.preventDefault()
  }, { passive: false })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
