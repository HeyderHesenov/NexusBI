/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F5F3EE',
        panel: '#FFFFFF',
        grid: '#E6E2D8',
        ink: '#161820',
        muted: '#6B7180',
        brand: { DEFAULT: '#221F52', soft: '#34316B' },
        signal: { DEFAULT: '#F4A100', press: '#D98C00' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(34,31,82,0.04), 0 8px 24px -12px rgba(34,31,82,0.14)',
        key: '0 2px 0 #D98C00',
      },
      backgroundImage: {
        grid:
          'linear-gradient(to right, #E6E2D8 1px, transparent 1px),' +
          'linear-gradient(to bottom, #E6E2D8 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}
