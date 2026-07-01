import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import az from './locales/az.json'

export const LANGS = [
  { code: 'az', label: 'Azərbaycan' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
] as const

export type Lang = (typeof LANGS)[number]['code']

export const STORAGE_KEY = 'nexusbi_lang'

// Only Azerbaijani (default + fallback) is bundled; the other languages are
// dynamically imported on first use so the initial bundle stays lean.
const loaders: Record<Exclude<Lang, 'az'>, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  ru: () => import('./locales/ru.json'),
  tr: () => import('./locales/tr.json'),
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && LANGS.some((l) => l.code === v)
}

i18n.use(initReactI18next).init({
  resources: { az: { translation: az } },
  lng: 'az',
  fallbackLng: 'az',
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
})

/** Lazy-load a language bundle (if needed) then switch to it. */
export async function loadLanguage(lang: Lang): Promise<void> {
  if (lang !== 'az' && !i18n.hasResourceBundle(lang, 'translation')) {
    const mod = await loaders[lang]()
    i18n.addResourceBundle(lang, 'translation', mod.default, true, true)
  }
  await i18n.changeLanguage(lang)
}

export default i18n
