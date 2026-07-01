import { create } from 'zustand'
import { STORAGE_KEY, isLang, loadLanguage, type Lang } from '../i18n'

function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY)
  return isLang(saved) ? saved : 'az'
}

interface LocaleState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    localStorage.setItem(STORAGE_KEY, lang)
    // Lazy-load + switch (no reload — react-i18next re-renders subscribers).
    loadLanguage(lang).catch(() => undefined)
    set({ lang })
    // Faz 2: persist to the user profile so the choice follows the account.
  },
}))

/** Apply the persisted language once at startup (before/at first render). */
export function bootstrapLanguage(): Promise<void> {
  return loadLanguage(initialLang())
}
