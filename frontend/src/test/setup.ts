import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
// Initialize i18n (Azerbaijani bundled) so components using t() render real
// strings in tests instead of raw keys — matches the app's default language.
import '../i18n'

// jsdom lacks these; stub them so animation hooks and CSV download don't throw.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
}
