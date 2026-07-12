import { ArrowRight, Check, ListChecks, Send, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopilotAction } from '../../hooks/useCopilotAction'
import { copilotNavTarget } from '../../lib/copilotNav'
import { useCopilotStore } from '../../store/copilotStore'
import { RevealText } from '../charts/RevealText'

const SUGGESTION_KEYS = [
  'copilotWidget.suggestion1',
  'copilotWidget.suggestion2',
  'copilotWidget.suggestion3',
]

export function CopilotWidget() {
  const { t } = useTranslation()
  const { open, sending, thread, toggle, setOpen, send, approve, cancel } = useCopilotStore()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const runAction = useCopilotAction(() => setOpen(false))

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, sending, open])

  const scrollToEnd = useCallback(
    () => endRef.current?.scrollIntoView({ behavior: 'auto' }),
    [],
  )

  const submit = (value?: string) => {
    const q = (value ?? text).trim()
    if (!q) return
    setText('')
    send(q)
  }

  return (
    <>
      <button
        onClick={toggle}
        aria-label={t('copilotWidget.assistantAria')}
        className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-accent text-bg shadow-pop transition hover:bg-accent-press active:translate-y-px"
      >
        {open ? <X size={22} /> : <Sparkles size={22} strokeWidth={2.5} />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[32rem] w-[calc(100vw-3rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles size={18} className="text-accent" />
            <h3 className="font-display text-base font-bold text-ink">{t('copilotWidget.title')}</h3>
            <span className="ml-auto text-xs text-ink-faint">{t('copilotWidget.agentic')}</span>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {thread.length === 0 && (
              <div className="mt-2">
                <p className="text-sm text-ink-soft">
                  {t('copilotWidget.greeting')}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {SUGGESTION_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => submit(t(key))}
                      className="rounded-xl border border-line px-3 py-2 text-left text-sm text-ink-soft transition hover:border-accent hover:text-ink"
                    >
                      {t(key)}
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
                  {m.role === 'assistant' && i === thread.length - 1 ? (
                    <RevealText
                      text={m.content}
                      className="whitespace-pre-wrap"
                      onType={scrollToEnd}
                    />
                  ) : (
                    m.content
                  )}
                </div>
                {m.plan && m.plan.length > 0 && m.pendingMessage && (
                  <div className="mt-2 rounded-xl border border-line bg-surface-2 p-3 text-left">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                      <ListChecks size={13} className="text-accent" /> {t('copilotWidget.plan')}
                    </div>
                    <ol className="space-y-1">
                      {m.plan.map((s, k) => (
                        <li key={k} className="flex gap-2 text-xs text-ink-soft">
                          <span className="font-mono text-ink-faint">{k + 1}.</span>
                          <span>{s.summary || s.tool}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        onClick={() => approve(i)}
                        disabled={m.approving || sending}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
                      >
                        <Check size={13} /> {m.approving ? t('copilotWidget.executing') : t('copilotWidget.approve')}
                      </button>
                      <button
                        onClick={() => cancel(i)}
                        disabled={m.approving || sending}
                        className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-soft transition hover:text-ink disabled:opacity-50"
                      >
                        {t('copilotWidget.cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 flex flex-col items-start gap-1.5">
                    {m.actions.map((a, j) => (
                      <button
                        key={j}
                        onClick={() => runAction(a)}
                        className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent transition hover:border-accent"
                      >
                        <span>✓ {a.label}</span>
                        {copilotNavTarget(a) && <ArrowRight size={12} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-1.5 text-sm text-ink-faint">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {t('copilotWidget.thinking')}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-line p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={t('copilotWidget.inputPlaceholder')}
              disabled={sending}
              className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={() => submit()}
              disabled={!text.trim() || sending}
              aria-label={t('copilotWidget.send')}
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
