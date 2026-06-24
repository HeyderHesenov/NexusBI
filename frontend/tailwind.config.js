/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#131418',
        surface: { DEFAULT: '#1A1C21', '2': '#212429' },
        line: { DEFAULT: '#2A2E35', strong: '#363B43' },
        ink: { DEFAULT: '#ECEAE6', soft: '#A8ADB5', faint: '#6E747D' },
        accent: { DEFAULT: '#0E9F6E', press: '#0B7E58', soft: 'rgba(14,159,110,0.12)' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 14px 32px -18px rgba(0,0,0,0.7)',
        pop: '0 8px 24px -10px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}
