import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// `npm run build:demo` builds the static demo for GitHub Pages, which serves it under
// /<repo name>/ (DEMO_BASE overrides that, e.g. "/" for a custom domain).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'demo' ? (process.env.DEMO_BASE ?? '/2026ZothacksTeam8/') : '/',
}))
