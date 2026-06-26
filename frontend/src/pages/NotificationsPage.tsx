import { useEffect } from 'react'
import { BellOff, CheckCheck, Sparkles } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('az-AZ', { dateStyle: 'short', timeStyle: 'short' })
}

export function NotificationsPage() {
  const { items, unread, generating, load, generate, markAllRead } = useNotificationStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Bildirişlər</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Bildirişlər</h1>
        </div>
        <div className="flex gap-2">
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

      {items.length === 0 ? (
        <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <BellOff size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">Bildiriş yoxdur</p>
          <p className="mt-1 text-sm text-ink-soft">
            Alert qur (Hesabatlar → saxlanan sorğu) — şərt pozulanda burada görünəcək.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-2xl border bg-surface p-4 ${
                n.read ? 'border-line' : 'border-accent/40'
              }`}
            >
              <div className="flex items-start gap-3">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                <div className="min-w-0">
                  <p className="font-medium text-ink">{n.title}</p>
                  <p className="text-sm text-ink-soft">{n.body}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {fmt(n.created_at)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
