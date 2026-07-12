import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Hash, Plus, Send, Users } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import * as chatApi from '../api/chat'
import { Avatar } from '../components/ui/Avatar'
import { Field, FIELD, Select } from '../components/ui/form'
import { useFormatDate } from '../hooks/useFormatDate'

export function ChatPage() {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const userId = useAuthStore((s) => s.user?.id)
  const { workspaces, load: loadWorkspaces } = useWorkspaceStore()
  const {
    activeRoom, connected, messages, channels, dmPeers,
    openRoom, send, close, loadChannels, loadDmPeers,
  } = useChatStore()

  const [wsId, setWsId] = useState('')
  const [activeLabel, setActiveLabel] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const role = useMemo(() => workspaces.find((w) => w.id === wsId)?.role, [workspaces, wsId])
  const canCreateChannel = role === 'owner' || role === 'editor'

  useEffect(() => {
    loadWorkspaces().catch(() => undefined)
    loadDmPeers().catch(() => undefined)
    return () => close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Default the workspace selection to the first one available.
  useEffect(() => {
    if (!wsId && workspaces.length) setWsId(workspaces[0].id)
  }, [workspaces, wsId])

  // Load channels whenever the selected workspace changes.
  useEffect(() => {
    if (wsId) loadChannels(wsId).catch(() => undefined)
  }, [wsId, loadChannels])

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const enterRoom = async (roomKey: string, label: string) => {
    try {
      const [ticket, hist] = await Promise.all([
        chatApi.roomTicket(roomKey),
        chatApi.history(roomKey),
      ])
      openRoom(roomKey, ticket, hist)
      setActiveLabel(label)
      chatApi.markRead(roomKey).then(() => {
        if (wsId) loadChannels(wsId).catch(() => undefined)
      })
    } catch {
      /* interceptor toast */
    }
  }

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newChannel.trim()
    if (!name || !wsId) return
    try {
      await chatApi.createChannel(wsId, name)
      setNewChannel('')
      await loadChannels(wsId)
    } catch {
      /* interceptor toast */
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (draft.trim()) {
      send(draft.trim())
      setDraft('')
    }
  }

  const openDm = (peer: chatApi.DMPeer) => {
    if (!userId) return
    enterRoom(chatApi.dmRoom(userId, peer.user_id), peer.full_name || peer.email)
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('nav.chat')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('chatPage.title')}</h1>
      </header>

      {workspaces.length === 0 ? (
        <div className="grid min-h-[50vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <div>
            <Users size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">{t('chatPage.noWorkspace')}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          {/* ── Left: channels + DMs ── */}
          <aside className="space-y-5 rounded-2xl border border-line bg-surface p-4">
            {workspaces.length > 1 && (
              <Field id="chat-ws" label={t('chatPage.workspace')}>
                <Select
                  id="chat-ws"
                  value={wsId}
                  onChange={(e) => setWsId(e.target.value)}
                  options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                />
              </Field>
            )}

            <div>
              <p className="eyebrow mb-2">{t('chatPage.channels')}</p>
              <ul className="space-y-0.5">
                {channels.length === 0 && (
                  <li className="px-2 py-1 text-xs text-ink-faint">{t('chatPage.noChannels')}</li>
                )}
                {channels.map((c) => {
                  const room = chatApi.channelRoom(c.workspace_id, c.id)
                  const active = room === activeRoom
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => enterRoom(room, `# ${c.name}`)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                          active ? 'bg-accent-soft text-ink' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                        }`}
                      >
                        <Hash size={14} className="shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {c.unread > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                            {c.unread}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {canCreateChannel && (
                <form onSubmit={createChannel} className="mt-2 flex items-center gap-1.5">
                  <input
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value)}
                    placeholder={t('chatPage.newChannelPlaceholder')}
                    className={`${FIELD} py-1.5 text-sm`}
                    aria-label={t('chatPage.newChannel')}
                  />
                  <button
                    type="submit"
                    disabled={!newChannel.trim()}
                    aria-label={t('chatPage.newChannel')}
                    title={t('chatPage.newChannel')}
                    className="shrink-0 rounded-lg border border-accent/40 bg-accent-soft p-2 text-accent transition hover:border-accent disabled:opacity-50"
                  >
                    <Plus size={15} />
                  </button>
                </form>
              )}
            </div>

            <div>
              <p className="eyebrow mb-2">{t('chatPage.directMessages')}</p>
              <ul className="space-y-0.5">
                {dmPeers.length === 0 && (
                  <li className="px-2 py-1 text-xs text-ink-faint">{t('chatPage.noPeers')}</li>
                )}
                {dmPeers.map((p) => {
                  const room = userId ? chatApi.dmRoom(userId, p.user_id) : ''
                  const active = room === activeRoom
                  return (
                    <li key={p.user_id}>
                      <button
                        onClick={() => openDm(p)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                          active ? 'bg-accent-soft text-ink' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                        }`}
                      >
                        <Avatar name={p.full_name} email={p.email} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{p.full_name || p.email}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </aside>

          {/* ── Right: message thread ── */}
          <section className="flex min-h-[60vh] flex-col rounded-2xl border border-line bg-surface">
            {activeRoom ? (
              <>
                <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <span className="font-display text-sm font-semibold text-ink">{activeLabel}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-line'}`}
                    title={connected ? t('chatPage.connected') : t('chatPage.connecting')}
                  />
                </div>
                <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.length === 0 ? (
                    <p className="grid h-full place-items-center text-sm text-ink-faint">{t('chatPage.noMessages')}</p>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className="flex items-start gap-2.5">
                        <Avatar name={m.author_name} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-medium text-ink">{m.author_name}</span>
                            <span className="text-[10px] text-ink-faint">
                              {fmtDate(m.created_at, { mode: 'short' })}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{m.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t('chatPage.messagePlaceholder')}
                    className={FIELD}
                    aria-label={t('chatPage.messagePlaceholder')}
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    aria-label={t('chatPage.send')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
                  >
                    <Send size={15} /> {t('chatPage.send')}
                  </button>
                </form>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div>
                  <Hash size={22} className="mx-auto text-ink-faint" />
                  <p className="mt-2 text-sm text-ink-soft">{t('chatPage.pickRoom')}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
