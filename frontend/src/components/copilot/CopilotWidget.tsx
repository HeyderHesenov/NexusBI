import { ArrowRight, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CopilotAction } from '../../api/copilot'
import { useCopilotStore } from '../../store/copilotStore'
import { useDashboardStore } from '../../store/dashboardStore'

const SUGGESTIONS = [
  'Q4 gəlirini analiz edən dashboard qur',
  'Ən çox satan 5 məhsul hansıdır?',
  'Regionlar üzrə gəlir paylanması',
]

export function CopilotWidget() {
  const { open, sending, thread, toggle, setOpen, send } = useCopilotStore()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, sending, open])

  const submit = (value?: string) => {
    const t = (value ?? text).trim()
    if (!t) return
    setText('')
    send(t)
  }

  const runAction = async (a: CopilotAction) => {
    if (a.dashboard_id) {
      await useDashboardStore.getState().loadList().catch(() => undefined)
      await useDashboardStore.getState().open(a.dashboard_id).catch(() => undefined)
      navigate('/dashboards')
      setOpen(false)
    } else if (a.query_log_id) {
      navigate('/history')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={toggle}
        aria-label="AI köməkçi"
        className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-accent text-bg shadow-pop transition hover:bg-accent-press active:translate-y-px"
      >
        {open ? <X size={22} /> : <Sparkles size={22} strokeWidth={2.5} />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[32rem] w-[calc(100vw-3rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles size={18} className="text-accent" />
            <h3 className="font-display text-base font-bold text-ink">AI Köməkçi</h3>
            <span className="ml-auto text-xs text-ink-faint">Agentik</span>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {thread.length === 0 && (
              <div className="mt-2">
                <p className="text-sm text-ink-soft">
                  Salam! Sənin adından sorğu işlədə və dashboard qura bilərəm. Bir şey soruş:
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="rounded-xl border border-line px-3 py-2 text-left text-sm text-ink-soft transition hover:border-accent hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {thread.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-accent text-bg'
                      : 'border border-line bg-surface-2 text-ink'
                  }`}
                >
                  {m.content}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 flex flex-col items-start gap-1.5">
                    {m.actions.map((a, j) => (
                      <button
                        key={j}
                        onClick={() => runAction(a)}
                        className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition hover:border-accent"
                      >
                        <span>✓ {a.label}</span>
                        {(a.dashboard_id || a.query_log_id) && <ArrowRight size={12} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-1.5 text-sm text-ink-faint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                Düşünürəm…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-line p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Soruş və ya tapşır…"
              disabled={sending}
              className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => submit()}
              disabled={!text.trim() || sending}
              aria-label="Göndər"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-bg transition hover:bg-accent-press disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
