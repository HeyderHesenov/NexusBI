import { Check, Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGS } from '../../i18n'
import { useLocaleStore } from '../../store/localeStore'

/** Top-bar language switcher: a globe icon that opens a panel of available
 * languages. Switching is instant (react-i18next re-render, no reload). */
export function LanguageSwitcher() {
  const { t } = useTranslation()
  const { lang, setLang } = useLocaleStore()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t('topbar.language')}
        title={t('topbar.language')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink focus-visible:border-accent focus-visible:outline-none"
      >
        <Globe size={15} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t('topbar.language')}
          className="palette-in absolute right-0 top-10 z-50 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {LANGS.map((l) => {
            const active = l.code === lang
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={active}
                onClick={() => {
                  setLang(l.code)
                  setOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'bg-surface-2 text-ink' : 'text-ink-soft hover:bg-surface-2'
                }`}
              >
                <span>{l.label}</span>
                {active && <Check size={14} className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
