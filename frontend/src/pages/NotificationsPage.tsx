import { useEffect, useMemo, useState } from 'react'
import { Bell, BellOff, CheckCheck, Sparkles, Sunrise } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'
import { IntegrationsPanel } from '../components/IntegrationsPanel'
import { Dropdown, type DropdownOption } from '../components/ui/Dropdown'
import { CATEGORY_META, CATEGORY_ORDER } from '../lib/notificationCategories'
import type { NotificationCategory } from '../types'

type Filter = NotificationCategory | 'all'

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('az-AZ', { dateStyle: 'short', timeStyle: 'short' })
}

export function NotificationsPage() {
  const { items, unread, generating, briefing, load, generate, generateDigest, markAllRead, markOneRead } =
    useNotificationStore()
  const [active, setActive] = useState<Filter>('all')

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  // Per-category unread counts drive the chip badges.
  const unreadByCategory = useMemo(() => {
    const counts = {} as Record<NotificationCategory, number>
    for (const n of items) {
      if (!n.read) counts[n.category] = (counts[n.category] ?? 0) + 1
    }
    return counts
  }, [items])

  const filterOptions: DropdownOption<Filter>[] = [
    { value: 'all', label: 'Hamısı', Icon: Bell, count: unread },
    ...CATEGORY_ORDER.map((c) => ({
      value: c,
      label: CATEGORY_META[c].label,
      Icon: CATEGORY_META[c].Icon,
      count: unreadByCategory[c] ?? 0,
    })),
  ]

  const visible = active === 'all' ? items : items.filter((n) => n.category === active)

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Mərkəz</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Bildirişlər</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => generateDigest()}
            disabled={briefing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Sunrise size={15} className={briefing ? 'animate-pulse' : ''} />
            {briefing ? 'Hazırlanır…' : 'Səhər brifi'}
          </button>
          <button
            onClick={() => generate()}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold text-accent transition hover:border-accent disabled:opacity-60"
          >
            <Sparkles size={15} className={generating ? 'animate-pulse' : ''} />
            {generating ? 'Təhlil…' : 'Smart insight yarat'}
          </button>
          {unread > 0 && (
            <button
              onClick={() => markAllRead()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <CheckCheck size={15} /> Hamısını oxudum
            </button>
          )}
        </div>
      </header>

      <div className="mb-5">
        <Dropdown
          ariaLabel="Bildiriş kateqoriyası"
          options={filterOptions}
          value={active}
          onChange={setActive}
          className="w-60"
        />
      </div>

      {visible.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <BellOff size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">
              {active === 'all' ? 'Bildiriş yoxdur' : 'Bu kateqoriyada bildiriş yoxdur'}
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              {active === 'all'
                ? 'Alert qur (Hesabatlar → saxlanan sorğu) — şərt pozulanda burada görünəcək.'
                : 'Başqa kateqoriyaya keç və ya yeni brif/insight yarat.'}
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((n) => {
            const brief = n.category === 'digest'
            // Guard the runtime API boundary: an unknown category (e.g. one shipped
            // backend-first) falls back to the insight icon instead of crashing the list.
            const { Icon } = CATEGORY_META[n.category] ?? CATEGORY_META.insight
            return (
              <li key={n.id}>
                <button
                  onClick={() => markOneRead(n.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    brief
                      ? 'border-accent/40 bg-accent-soft'
                      : n.read
                        ? 'border-line bg-surface hover:border-line-strong'
                        : 'border-accent/40 bg-surface hover:border-accent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                        n.read ? 'bg-surface-2 text-ink-faint' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <p className={`min-w-0 font-medium text-ink ${brief ? 'font-display text-base' : ''}`}>
                          {n.title}
                        </p>
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      </div>
                      <p className={`text-sm text-ink-soft ${brief ? 'mt-1 whitespace-pre-wrap leading-relaxed' : ''}`}>
                        {n.body}
                      </p>
                      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        {fmt(n.created_at)}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <IntegrationsPanel />
    </div>
  )
}
