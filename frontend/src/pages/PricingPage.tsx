import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Sparkles } from 'lucide-react'
import { useBillingStore } from '../store/billingStore'
import { useFormatNumber } from '../hooks/useFormatNumber'
import type { Plan } from '../types'

const HIGHLIGHT = 'max' // visually featured plan

export function PricingPage() {
  const { t } = useTranslation()
  const { plans, usage, loading, loadPlans, loadUsage, upgrade, startCheckout, openPortal, armButtons } =
    useBillingStore()

  useEffect(() => {
    loadPlans().catch(() => undefined)
    loadUsage().catch(() => undefined)
  }, [loadPlans, loadUsage])

  // Leaving for Stripe deliberately leaves the buttons disabled, but the browser
  // serves this page from bfcache on Back — same React tree, same store, so
  // nothing re-mounts and every button would stay dead until a hard reload.
  useEffect(() => {
    const restored = (e: PageTransitionEvent) => {
      if (e.persisted) armButtons()
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [armButtons])

  const currentTier = usage?.tier ?? 'free'
  const unlimited = (usage?.limit ?? 0) < 0
  const paid = usage?.payments_enabled ?? false
  const subscribed = usage?.has_subscription ?? false
  // A customer OUTLIVES their subscription — after cancelling they still have
  // invoices to read and a card to update, so the portal stays reachable.
  const billingAccount = usage?.has_billing_account ?? false

  // Three buttons, one decision, made from what the server reports rather than
  // from a build-time flag: with Stripe configured a paid plan starts a real
  // checkout and LEAVING a paid plan happens in Stripe's portal, because a
  // subscription the customer still pays for cannot be cancelled by us flipping
  // a column. Without Stripe (demo) the existing mock stays.
  const select = (planKey: string) => {
    if (!paid) return upgrade(planKey)
    // While a subscription is live, EVERY change goes through the portal: a
    // second checkout session does not replace the first, Stripe bills both.
    if (subscribed) return openPortal()
    return startCheckout(planKey)
  }

  // A button that does nothing reads as a broken app. With payments on, the free
  // plan is only actionable for someone who has something to cancel.
  const actionable = (planKey: string, price: number) =>
    !paid || price > 0 || subscribed || planKey === currentTier

  return (
    <div className="w-full">
      <div className="mb-8 text-center">
        <p className="eyebrow mb-2 text-accent">{t('pricingPage.eyebrow')}</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
          {t('pricingPage.heading')}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {t('pricingPage.subheading')}
        </p>
      </div>

      {unlimited && (
        <div className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-ink">
          <Sparkles size={15} className="text-accent" />
          <span>
            <span className="font-semibold">{t('pricingPage.demoUnlimitedLabel')}</span>{' '}
            {t('pricingPage.demoUnlimitedText')}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            current={plan.key === currentTier}
            featured={plan.key === HIGHLIGHT}
            loading={loading || !actionable(plan.key, plan.price_usd)}
            onSelect={() => select(plan.key)}
          />
        ))}
      </div>

      {subscribed && (
        <p className="mt-4 text-center text-xs text-ink-faint">{t('pricingPage.planChangeHint')}</p>
      )}

      {billingAccount && (
        <div className="mt-6 text-center">
          <button
            onClick={() => openPortal()}
            disabled={loading}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {t('pricingPage.manageSubscription')}
          </button>
        </div>
      )}

      {usage && !unlimited && (
        <p className="mt-6 text-center font-mono text-xs text-ink-faint">
          {t('pricingPage.usageThisMonth', { used: usage.used, limit: usage.limit })}
        </p>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  current,
  featured,
  loading,
  onSelect,
}: {
  plan: Plan
  current: boolean
  featured: boolean
  loading: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const fmtNum = useFormatNumber()
  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-surface p-5 transition-colors ${
        current
          ? 'border-accent ring-1 ring-accent'
          : featured
            ? 'border-line-strong'
            : 'border-line'
      }`}
    >
      {featured && !current && (
        <span className="absolute -top-2.5 left-5 flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">
          <Sparkles size={11} /> {t('pricingPage.popular')}
        </span>
      )}

      <h3 className="font-display text-lg font-bold text-ink">{plan.name}</h3>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold text-ink">${plan.price_usd}</span>
        <span className="text-xs text-ink-faint">{t('pricingPage.perMonth')}</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ink-soft">
        {t('pricingPage.quotaPerMonth', { quota: fmtNum(plan.monthly_quota) })}
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-ink-soft">
            <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        disabled={current || loading}
        onClick={onSelect}
        className={`mt-5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
          current
            ? 'cursor-default border border-line bg-surface-2 text-ink-faint'
            : 'bg-accent text-bg hover:bg-accent-press'
        }`}
      >
        {current
          ? t('pricingPage.currentPlan')
          : plan.price_usd === 0
            ? t('pricingPage.switch')
            : t('pricingPage.upgrade')}
      </button>
    </div>
  )
}
