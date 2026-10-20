import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves project sites below /<repository>/.
  // Keep local development at the domain root by default.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
})
