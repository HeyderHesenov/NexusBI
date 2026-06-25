/** @type {import('tailwindcss').Config} */

// Semantic tokens resolve to CSS variables (RGB channel triplets) so the same
// utility classes work in both light and dark themes, and opacity modifiers
// (bg-bg/70, border-accent/30) keep working via the <alpha-value> placeholder.
const token = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('--bg'),
        surface: { DEFAULT: token('--surface'), '2': token('--surface-2') },
        line: { DEFAULT: token('--line'), strong: token('--line-strong') },
        ink: { DEFAULT: token('--ink'), soft: token('--ink-soft'), faint: token('--ink-faint') },
        accent: {
          DEFAULT: token('--accent'),
          press: token('--accent-press'),
          soft: token('--accent-soft'),
        },
      },
      fontFamily: {
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Soft, Claude-like elevation — quiet borders, gentle drop.
        card: '0 1px 2px rgb(var(--shadow) / 0.04), 0 8px 24px -16px rgb(var(--shadow) / 0.25)',
        pop: '0 8px 28px -12px rgb(var(--shadow) / 0.30)',
      },
    },
  },
  plugins: [],
}
