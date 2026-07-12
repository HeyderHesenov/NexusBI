import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Hash, ListChecks, Lock, Plus, Search, Send, Sparkles, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import * as chatApi from '../api/chat'
import { isAiMessage } from '../api/chat'
import type { ChatMessage, LastMessage } from '../api/chat'
import { Avatar, avatarHue } from '../components/ui/Avatar'
import { Field, FIELD, Select } from '../components/ui/form'
import { useCopilotAction } from '../hooks/useCopilotAction'
import { useFormatDate } from '../hooks/useFormatDate'
import { copilotNavTarget } from '../lib/copilotNav'
import { dayBucket, isSameDay } from '../lib/format'

/** Messages by the same author within this window collapse into one bubble group. */
const GROUP_GAP_MS = 5 * 60 * 1000

type ThreadItem =
  | { kind: 'day'; id: string; date: Date }
  | {
      kind: 'msg'
      msg: ChatMessage
      own: boolean
      firstInGroup: boolean
      lastInGroup: boolean
    }

function buildThread(messages: ChatMessage[], selfId: string | undefined): ThreadItem[] {
  const items: ThreadItem[] = []
  messages.forEach((msg, i) => {
    const date = new Date(msg.created_at)
    const prev = i > 0 ? messages[i - 1] : null
    const next = i < messages.length - 1 ? messages[i + 1] : null
    if (!prev || !isSameDay(new Date(prev.created_at), date)) {
      items.push({ kind: 'day', id: `day-${msg.id}`, date })
    }
    const groupsWith = (other: ChatMessage | null) =>
      other !== null &&
      other.author_id === msg.author_id &&
      isSameDay(new Date(other.created_at), date) &&
      Math.abs(date.getTime() - new Date(other.created_at).getTime()) < GROUP_GAP_MS
    items.push({
      kind: 'msg',
      msg,
      own: msg.author_id === selfId,
      firstInGroup: !groupsWith(prev),
      lastInGroup: !groupsWith(next),
    })
  })
  return items
}

interface ActiveMeta {
  kind: 'channel' | 'dm' | 'ai'
  label: string
  peerId?: string
}

/** Sparkles badge — the assistant's "avatar" in the rail, header and thread. */
function AiBadge({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7'
  return (
    <span
      aria-hidden="true"
      className={`grid ${box} shrink-0 place-items-center rounded-full bg-accent-soft text-accent`}
    >
      <Sparkles size={size === 'lg' ? 16 : 14} />
    </span>
  )
}

export function ChatPage() {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const navigate = useNavigate()
  const runAction = useCopilotAction()
  const userId = useAuthStore((s) => s.user?.id)
  const aiChat = useAuthStore((s) => s.user?.ai_chat)
  const { workspaces, load: loadWorkspaces } = useWorkspaceStore()
  const {
    activeRoom, connected, messages, participants, typing, channels, dmPeers,
    openRoom, send, sendTyping, close, loadChannels, loadDmPeers,
  } = useChatStore()

  const [wsId, setWsId] = useState('')
  const [active, setActive] = useState<ActiveMeta | null>(null)
  const [query, setQuery] = useState('')
  const [newChannel, setNewChannel] = useState('')
  const [draft, setDraft] = useState('')
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const prevRoomRef = useRef<string | null>(null)

  const role = useMemo(() => workspaces.find((w) => w.id === wsId)?.role, [workspaces, wsId])
  const canCreateChannel = role === 'owner' || role === 'editor'

  useEffect(() => {
    loadWorkspaces().catch(() => undefined)
    loadDmPeers().catch(() => undefined)
    return () => close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!wsId && workspaces.length) setWsId(workspaces[0].id)
  }, [workspaces, wsId])

  useEffect(() => {
    if (wsId) loadChannels(wsId).catch(() => undefined)
  }, [wsId, loadChannels])

  // Pin the thread to the newest message: jump on room open, glide on appends.
  useEffect(() => {
    const behavior = prevRoomRef.current === activeRoom ? 'smooth' : 'auto'
    prevRoomRef.current = activeRoom
    endRef.current?.scrollIntoView({ behavior })
  }, [messages, activeRoom])

  // Reading along: silence the marker while the room is open (debounced).
  useEffect(() => {
    if (!activeRoom || messages.length === 0) return
    const id = setTimeout(() => {
      chatApi.markRead(activeRoom).catch(() => undefined)
    }, 1000)
    return () => clearTimeout(id)
  }, [activeRoom, messages.length])

  const enterRoom = async (roomKey: string, meta: ActiveMeta) => {
    try {
      const [ticket, hist] = await Promise.all([
        chatApi.roomTicket(roomKey),
        chatApi.history(roomKey),
      ])
      openRoom(roomKey, ticket, hist)
      setActive(meta)
      chatApi
        .markRead(roomKey)
        .then(() => {
          if (wsId) loadChannels(wsId).catch(() => undefined)
          loadDmPeers().catch(() => undefined)
        })
        .catch(() => undefined)
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

  // The plan card's status flips via the chat_update frame; busyPlanId only
  // bridges the gap between the click and that broadcast.
  const resolvePlan = async (messageId: string, action: 'approve' | 'cancel') => {
    setBusyPlanId(messageId)
    try {
      await (action === 'approve' ? chatApi.approveAi(messageId) : chatApi.cancelAi(messageId))
    } catch {
      /* interceptor toast */
    } finally {
      setBusyPlanId(null)
    }
  }

  const thread = useMemo(() => buildThread(messages, userId), [messages, userId])
  const liveLast: ChatMessage | undefined = messages[messages.length - 1]

  const q = query.trim().toLowerCase()
  const visibleChannels = q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels
  const visiblePeers = q
    ? dmPeers.filter((p) => (p.full_name || p.email).toLowerCase().includes(q))
    : dmPeers

  const railTime = (iso: string) => {
    const d = new Date(iso)
    const bucket = dayBucket(d)
    if (bucket === 'today') return fmtDate(d, { mode: 'time' })
    if (bucket === 'yesterday') return t('chatPage.yesterday')
    return fmtDate(d, { mode: 'date' })
  }

  const daySeparator = (date: Date) => {
    const bucket = dayBucket(date)
    if (bucket === 'today') return t('chatPage.today')
    if (bucket === 'yesterday') return t('chatPage.yesterday')
    return fmtDate(date, { mode: 'date' })
  }

  // Presence + typing for the room header (never counting yourself).
  const typingNames = Object.entries(typing)
    .filter(([id]) => id !== userId)
    .map(([, name]) => name)
  const onlineIds = new Set(
    participants.map((p) => p.user_id).filter((id): id is string => id !== null),
  )
  const headerSubline = (() => {
    if (!active) return ''
    if (typingNames.length === 1) return t('chatPage.typing', { name: typingNames[0] })
    if (typingNames.length > 1) return t('chatPage.typingMany', { count: typingNames.length })
    if (active.kind === 'ai') return t('chatPage.aiHint')
    if (active.kind === 'dm') {
      return active.peerId && onlineIds.has(active.peerId) ? t('chatPage.onlineNow') : ''
    }
    return onlineIds.size > 0 ? t('chatPage.online', { count: onlineIds.size }) : ''
  })()

  const snippetFor = (room: string, fallback?: LastMessage | null) => {
    const last = room === activeRoom && liveLast ? liveLast : fallback
    if (!last) return null
    const who = last.author_id === userId ? t('chatPage.you') : last.author_name
    return { text: `${who}: ${last.content}`, at: last.created_at }
  }

  const conversationRow = (opts: {
    key: string
    room: string
    avatar: React.ReactNode
    name: string
    unread: number
    last?: LastMessage | null
    onSelect: () => void
  }) => {
    const isActive = opts.room === activeRoom
    const snippet = snippetFor(opts.room, opts.last)
    const unread = isActive ? 0 : opts.unread
    return (
      <li key={opts.key}>
        <button
          onClick={opts.onSelect}
          className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
            isActive ? 'bg-accent-soft' : 'hover:bg-surface-2'
          }`}
        >
          {opts.avatar}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {opts.name}
              </span>
              {snippet && (
                <span className="shrink-0 text-[10px] text-ink-faint">
                  {railTime(snippet.at)}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
                {snippet ? snippet.text : t('chatPage.noMessages')}
              </span>
              {unread > 0 && (
                <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                  {unread}
                </span>
              )}
            </span>
          </span>
        </button>
      </li>
    )
  }

  if (workspaces.length === 0) {
    return (
      <div className="grid min-h-[50vh] flex-1 place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
        <div>
          <Users size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('chatPage.noWorkspace')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:grid-cols-[20rem_1fr]">
        {/* ── Conversation rail ── */}
        <aside className="flex min-h-0 flex-col border-b border-line max-lg:max-h-72 lg:border-b-0 lg:border-r">
          <div className="space-y-2.5 border-b border-line p-3">
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
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('chatPage.searchPlaceholder')}
                aria-label={t('chatPage.searchPlaceholder')}
                className={`${FIELD} py-1.5 pl-8 text-sm`}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {/* Pinned assistant row — undefined tier means the user is still loading. */}
            {userId && aiChat === true && (
              <button
                onClick={() => enterRoom(chatApi.aiRoom(userId), { kind: 'ai', label: 'Nexus AI' })}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                  activeRoom === chatApi.aiRoom(userId) ? 'bg-accent-soft' : 'hover:bg-surface-2'
                }`}
              >
                <AiBadge />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">Nexus AI</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    {t('chatPage.aiHint')}
                  </span>
                </span>
              </button>
            )}
            {aiChat === false && (
              <button
                onClick={() => navigate('/pricing')}
                className="mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left opacity-70 transition hover:bg-surface-2 hover:opacity-100"
              >
                <AiBadge />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    Nexus AI <Lock size={12} className="text-ink-faint" />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">
                    {t('chatPage.aiLocked')}
                  </span>
                </span>
              </button>
            )}
            <p className="eyebrow px-2.5 pb-1.5 pt-1">{t('chatPage.channels')}</p>
            <ul className="space-y-0.5">
              {visibleChannels.length === 0 && (
                <li className="px-2.5 py-1 text-xs text-ink-faint">
                  {q ? t('chatPage.noResults') : t('chatPage.noChannels')}
                </li>
              )}
              {visibleChannels.map((c) =>
                conversationRow({
                  key: c.id,
                  room: chatApi.channelRoom(c.workspace_id, c.id),
                  avatar: (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-faint">
                      <Hash size={15} />
                    </span>
                  ),
                  name: c.name,
                  unread: c.unread,
                  last: c.last_message,
                  onSelect: () =>
                    enterRoom(chatApi.channelRoom(c.workspace_id, c.id), {
                      kind: 'channel',
                      label: c.name,
                    }),
                }),
              )}
            </ul>
            {canCreateChannel && (
              <form onSubmit={createChannel} className="mt-1.5 flex items-center gap-1.5 px-1">
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

            <p className="eyebrow px-2.5 pb-1.5 pt-4">{t('chatPage.directMessages')}</p>
            <ul className="space-y-0.5">
              {visiblePeers.length === 0 && (
                <li className="px-2.5 py-1 text-xs text-ink-faint">
                  {q ? t('chatPage.noResults') : t('chatPage.noPeers')}
                </li>
              )}
              {visiblePeers.map((p) => {
                const room = userId ? chatApi.dmRoom(userId, p.user_id) : ''
                return conversationRow({
                  key: p.user_id,
                  room,
                  avatar: (
                    <Avatar name={p.full_name} email={p.email} size="lg" colorSeed={p.user_id} />
                  ),
                  name: p.full_name || p.email,
                  unread: p.unread ?? 0,
                  last: p.last_message,
                  onSelect: () =>
                    userId &&
                    enterRoom(room, {
                      kind: 'dm',
                      label: p.full_name || p.email,
                      peerId: p.user_id,
                    }),
                })
              })}
            </ul>
          </div>
        </aside>

        {/* ── Thread ── */}
        <section className="flex min-h-0 flex-col bg-bg/40">
          {activeRoom && active ? (
            <>
              <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
                {active.kind === 'channel' ? (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-faint">
                    <Hash size={15} />
                  </span>
                ) : active.kind === 'ai' ? (
                  <AiBadge />
                ) : (
                  <Avatar name={active.label} size="lg" colorSeed={active.peerId} />
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold text-ink">
                    {active.label}
                  </p>
                  <p className="h-4 truncate text-xs text-ink-faint">{headerSubline}</p>
                </div>
                <span
                  className={`ml-auto h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-accent' : 'bg-line'}`}
                  title={connected ? t('chatPage.connected') : t('chatPage.connecting')}
                />
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {thread.length === 0 ? (
                  <p className="grid h-full place-items-center px-8 text-center text-sm text-ink-faint">
                    {active.kind === 'ai' ? t('chatPage.aiWelcome') : t('chatPage.noMessages')}
                  </p>
                ) : (
                  thread.map((item) => {
                    if (item.kind === 'day') {
                      return (
                        <div key={item.id} className="my-4 flex items-center gap-3">
                          <span className="h-px flex-1 bg-line" />
                          <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-medium text-ink-faint">
                            {daySeparator(item.date)}
                          </span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                      )
                    }
                    const { msg, own, firstInGroup, lastInGroup } = item
                    const ai = isAiMessage(msg)
                    const meta = ai ? msg.meta : null
                    const plan = meta?.kind === 'plan' ? meta : null
                    const actionable =
                      plan?.status === 'pending' && plan.requester_id === userId
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${own ? 'justify-end' : 'items-end gap-2'} ${
                          firstInGroup ? 'mt-3' : 'mt-0.5'
                        }`}
                      >
                        {!own && (
                          <span className="w-7 shrink-0">
                            {lastInGroup &&
                              (ai ? (
                                <AiBadge size="sm" />
                              ) : (
                                <Avatar name={msg.author_name} size="sm" colorSeed={msg.author_id} />
                              ))}
                          </span>
                        )}
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                            own
                              ? `bg-accent text-bg ${lastInGroup ? 'rounded-br-md' : ''}`
                              : `border border-line bg-surface-2 text-ink ${lastInGroup ? 'rounded-bl-md' : ''}`
                          }`}
                        >
                          {!own && firstInGroup && active.kind === 'channel' && (
                            <p
                              className="text-xs font-semibold"
                              style={
                                ai ? undefined : { color: `hsl(${avatarHue(msg.author_id)} 55% 42%)` }
                              }
                            >
                              {ai ? <span className="text-accent">{msg.author_name}</span> : msg.author_name}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                          {plan && (plan.plan?.length ?? 0) > 0 && (
                            <div className="mt-2 rounded-xl border border-line bg-surface p-3">
                              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                                <ListChecks size={13} className="text-accent" /> {t('chatPage.aiPlan')}
                              </div>
                              <ol className="space-y-1">
                                {plan.plan?.map((s, k) => (
                                  <li key={k} className="flex gap-2 text-xs text-ink-soft">
                                    <span className="font-mono text-ink-faint">{k + 1}.</span>
                                    <span>{s.summary || s.tool}</span>
                                  </li>
                                ))}
                              </ol>
                              {actionable ? (
                                <div className="mt-2.5 flex gap-2">
                                  <button
                                    onClick={() => resolvePlan(msg.id, 'approve')}
                                    disabled={busyPlanId === msg.id}
                                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
                                  >
                                    <Check size={13} />
                                    {busyPlanId === msg.id
                                      ? t('chatPage.aiExecuting')
                                      : t('chatPage.aiApprove')}
                                  </button>
                                  <button
                                    onClick={() => resolvePlan(msg.id, 'cancel')}
                                    disabled={busyPlanId === msg.id}
                                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-soft transition hover:text-ink disabled:opacity-50"
                                  >
                                    {t('chatPage.aiCancel')}
                                  </button>
                                </div>
                              ) : (
                                plan.status !== 'pending' && (
                                  <p className="mt-2 text-[11px] text-ink-faint">
                                    {plan.status === 'approved' && t('chatPage.aiApproved')}
                                    {plan.status === 'cancelled' && t('chatPage.aiCancelled')}
                                    {plan.status === 'failed' && t('chatPage.aiFailed')}
                                  </p>
                                )
                              )}
                            </div>
                          )}

                          {meta?.kind === 'actions' && (meta.actions?.length ?? 0) > 0 && (
                            <div className="mt-2 flex flex-col items-start gap-1.5">
                              {meta.actions?.map((a, j) => (
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

                          <span
                            className={`mt-0.5 block text-right text-[10px] ${
                              own ? 'text-bg/70' : 'text-ink-faint'
                            }`}
                          >
                            {fmtDate(msg.created_at, { mode: 'time' })}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={endRef} />
              </div>

              <form
                onSubmit={submit}
                className="flex items-center gap-2 border-t border-line bg-surface p-3"
              >
                <input
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    sendTyping()
                  }}
                  placeholder={t('chatPage.messagePlaceholder')}
                  aria-label={t('chatPage.messagePlaceholder')}
                  className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label={t('chatPage.send')}
                  title={t('chatPage.send')}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
                >
                  <Send size={16} />
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
    </div>
  )
}
