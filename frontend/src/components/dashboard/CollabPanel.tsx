import { MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCollabStore } from '../../store/collabStore'

function time(ts: string): string {
  return new Date(ts).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })
}

/** Slide-in team chat for a dashboard. Messages arrive live over the WS. */
export function CollabPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { messages, participants, connected, sendChat } = useCollabStore()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    sendChat(t)
    setText('')
  }

  if (!open) return null

  return (
    <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-sm flex-col border-l border-line bg-surface shadow-pop">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-accent" />
          <h3 className="font-display text-base font-bold text-ink">{t('collabPanel.team')}</h3>
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-ink-faint'}`}
            title={connected ? t('collabPanel.connected') : t('collabPanel.disconnected')}
          />
        </div>
        <button
          onClick={onClose}
          aria-label={t('collabPanel.close')}
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={16} />
        </button>
      </header>

      {participants.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
          {participants.map((p) => (
            <span
              key={p.conn_id}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: `${p.color}22`, color: p.color }}
            >
              {p.name}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-ink-faint">
            {t('collabPanel.emptyState')}
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-ink">{m.author_name}</span>
                <span className="font-mono text-[10px] text-ink-faint">{time(m.created_at)}</span>
              </div>
              <p className="text-ink-soft">{m.content}</p>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-line p-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('collabPanel.messagePlaceholder')}
          className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          aria-label={t('collabPanel.send')}
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl bg-accent text-bg transition hover:bg-accent-press disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
