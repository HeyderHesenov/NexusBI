/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type PluginOption } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'

// Strict CSP for the production HTML only. The key win is script-src: same-origin
// bundles + the hashed inline theme-init script + Google Identity Services, so no
// arbitrary inline JS can run. style 'unsafe-inline' is required by Tailwind/
// recharts inline styles. connect-src keeps https:/wss: for prod API flexibility.
// (Recompute the sha256 if index.html's inline <script> changes.)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-xYuRhdvtdkkGL2T9Z6Ma+UigXtUAv0H79x/u7vqL0Us=' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://*.googleusercontent.com",
  "connect-src 'self' http://localhost:8000 ws://localhost:8000 https://accounts.google.com https: wss:",
  'frame-src https://accounts.google.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // frame-ancestors is intentionally omitted — it's ignored in a <meta> CSP;
  // clickjacking is covered by X-Frame-Options/CSP on the server responses.
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

// `npm run analyze` (ANALYZE=true) emits a treemap of the built bundle to
// stats.html so heavy deps (recharts, etc.) are visible at a glance.
const analyzePlugins: PluginOption[] = process.env.ANALYZE
  ? [visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true })]
  : []

export default defineConfig({
  plugins: [react(), cspPlugin(), ...analyzePlugins],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
    // Unit tests live under src/; e2e/*.spec.ts belongs to Playwright, not Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors so the initial bundle stays small.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          mermaid: ['mermaid'],
        },
      },
    },
  },
})
