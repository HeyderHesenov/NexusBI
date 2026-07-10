import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Rocket, X } from 'lucide-react'
import { useOnboarding, type OnboardingStepKey } from '../../hooks/useOnboarding'

// Where each step points the user next. The query step has no route (they're
// already on the query console), so it renders without an arrow link.
const STEP_LINK: Record<OnboardingStepKey, string | null> = {
  source: '/sources',
  query: null,
  save: null,
  dashboard: '/dashboards',
}

/** Dismissible first-run checklist shown on the query console for new accounts.
 *  Steps derive their done-state from real store counts (see useOnboarding);
 *  hidden for the demo account and once everything is done or dismissed. */
export function OnboardingChecklist() {
  const { t } = useTranslation()
  const { visible, steps, completed, total, dismiss } = useOnboarding()
  if (!visible) return null

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
            <Rocket size={18} />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{t('onboarding.title')}</h2>
            <p className="text-xs text-ink-soft">
              {t('onboarding.progress', { done: completed, total })}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label={t('onboarding.dismiss')}
          className="rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <ol className="mt-4 space-y-1.5">
        {steps.map((s, i) => {
          const link = STEP_LINK[s.key]
          return (
            <li
              key={s.key}
              className="flex items-center gap-3 rounded-xl border border-line/60 px-3 py-2.5"
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold ${
                  s.done
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-ink-faint'
                }`}
              >
                {s.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${s.done ? 'text-ink-faint line-through' : 'text-ink'}`}>
                  {t(`onboarding.steps.${s.key}.title`)}
                </p>
                <p className="text-xs text-ink-soft">{t(`onboarding.steps.${s.key}.hint`)}</p>
              </div>
              {!s.done && link && (
                <Link
                  to={link}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-accent"
                >
                  {t('onboarding.go')} <ArrowRight size={12} />
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
