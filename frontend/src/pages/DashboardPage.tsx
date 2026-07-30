import { Eye, History, LayoutGrid, MessageCircle, MoreHorizontal, Plus, Presentation, Printer, Radio, RefreshCw, Send, Share2, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { Layouts } from 'react-grid-layout'
import type { DataStory } from '../types'
import { StoryMode } from '../components/story/StoryMode'
import { AddWidgetModal } from '../components/dashboard/AddWidgetModal'
import { CollabPanel } from '../components/dashboard/CollabPanel'
import { CollabSurface } from '../components/dashboard/CollabSurface'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { DashboardPrintView } from '../components/dashboard/DashboardPrintView'
import { GenerateDashboardModal } from '../components/dashboard/GenerateDashboardModal'
import { SaveDashboardModal } from '../components/dashboard/SaveDashboardModal'
import { ShareDashboardModal } from '../components/dashboard/ShareDashboardModal'
import { ShareToChatButton } from '../components/chat/ShareToChatButton'
import { SnapshotTimeline } from '../components/dashboard/SnapshotTimeline'
import { SnapshotView } from '../components/dashboard/SnapshotView'
import { ActionMenu } from '../components/ui/ActionMenu'
import type { ActionMenuItem, ActionMenuSection } from '../components/ui/ActionMenu'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { buildStory, getComments, getWsTicket } from '../api/dashboard'
import { useReflowDismiss } from '../hooks/useReflowDismiss'
import { useCollabStore } from '../store/collabStore'
import { useDashboardStore } from '../store/dashboardStore'
import { useSnapshotStore } from '../store/snapshotStore'

export function DashboardPage() {
  const { t } = useTranslation()
  const {
    list, current, refreshing, loadList, open, create, generate, remove,
    addWidget, removeWidget, refreshWidget, refreshAll, saveLayout, toggleLive,
  } = useDashboardStore()
  const live = current?.live_enabled ?? false
  // A workspace member viewing a SHARED dashboard: read-only (owned === false).
  const canEdit = current?.owned !== false
  const [searchParams, setSearchParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [pillMenu, setPillMenu] = useState<{ x: number; y: number; id: string; name: string } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [story, setStory] = useState<DataStory | null>(null)
  const [storyLoading, setStoryLoading] = useState(false)
  const [timeMachineOpen, setTimeMachineOpen] = useState(false)
  const [shareToChatOpen, setShareToChatOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const { participants, connect, disconnect } = useCollabStore()
  const snapshots = useSnapshotStore()

  useEffect(() => {
    loadList().catch(() => undefined)
  }, [loadList])

  // Deep-link: /dashboards?open=<id> opens a specific dashboard (used by the
  // Komanda page to open a dashboard shared to the team). Clear the param after.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId) return
    open(openId).catch(() => undefined)
    searchParams.delete('open')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams, open])

  // Join the live collaboration room for whichever dashboard is open.
  const currentId = current?.id

  // Reset the time machine when switching dashboards.
  const snapshotsReset = snapshots.reset
  useEffect(() => {
    setTimeMachineOpen(false)
    snapshotsReset()
  }, [currentId, snapshotsReset])
  useEffect(() => {
    // Collab (cursors/chat) is owner-only: the ws-ticket endpoint is owner-scoped,
    // so a member viewing a SHARED board can't join — skip it for read-only views.
    if (!currentId || !canEdit) return
    let cancelled = false
    // Mint a short-lived ws ticket so the long-lived JWT never lands in the URL.
    // Keep the token as a fallback so collab still works if the ticket call fails.
    const token = localStorage.getItem('nexusbi_token') ?? undefined
    Promise.all([
      getWsTicket(currentId).catch(() => undefined),
      getComments(currentId).catch(() => [] as Awaited<ReturnType<typeof getComments>>),
    ]).then(([ticket, history]) => {
      if (!cancelled) connect(currentId, { ticket, token }, history)
    })
    return () => {
      cancelled = true
      disconnect()
    }
  }, [currentId, canEdit, connect, disconnect])

  const openStory = async () => {
    if (!current) return
    setStoryLoading(true)
    try {
      setStory(await buildStory(current.id))
    } catch {
      /* interceptor toast */
    } finally {
      setStoryLoading(false)
    }
  }

  // Persist layout changes, debounced so dragging doesn't spam the API.
  const onLayoutChange = (layouts: Layouts) => {
    if (!current || current.owned === false) return  // read-only shared view
    const id = current.id
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveLayout(id, layouts as unknown as Record<string, unknown>).catch(() => undefined)
    }, 800)
  }

  // Browser print is modal: `afterprint` is how we learn the dialog closed and the
  // off-screen sheet can be unmounted. The timeout is a backstop — a browser that
  // never fires it must not leave the sheet mounted for the rest of the session.
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    const bail = setTimeout(done, 30_000)
    return () => {
      window.removeEventListener('afterprint', done)
      clearTimeout(bail)
    }
  }, [printing])

  const printWhenReady = useCallback(() => window.print(), [])

  // Overflow "Actions" menu — the lower-frequency / destructive controls, grouped
  // into sections so the toolbar stays a single row. Each section is pushed only
  // when its gate is met; ActionMenu self-hides when every section is empty
  // (read-only shared view / no dashboard open).
  const actionSections: ActionMenuSection[] = []
  if (current && current.widgets.length > 0) {
    const viewItems: ActionMenuItem[] = []
    // Story and refresh-all both call owner-scoped endpoints; print is a pure
    // client-side render, so a member viewing a shared board still gets it.
    if (canEdit) {
      viewItems.push(
        {
          key: 'story',
          label: storyLoading ? t('dashboardPage.preparing') : t('dashboardPage.story'),
          Icon: Presentation,
          onSelect: openStory,
          disabled: storyLoading,
        },
        {
          key: 'refresh',
          label: t('dashboardPage.refreshAll'),
          Icon: RefreshCw,
          onSelect: () => refreshAll(current.id),
          disabled: refreshing,
        },
      )
    }
    viewItems.push({
      key: 'print',
      label: printing ? t('dashboardPage.preparing') : t('dashboardPage.print'),
      Icon: Printer,
      onSelect: () => setPrinting(true),
      disabled: printing,
    })
    actionSections.push({ header: t('dashboardPage.sectionView'), items: viewItems })
  }
  if (current && canEdit) {
    actionSections.push({
      header: t('dashboardPage.sectionShare'),
      items: [
        { key: 'share', label: t('dashboardPage.share'), Icon: Share2, onSelect: () => setShareOpen(true) },
        {
          key: 'share-chat',
          label: t('shareDialog.toChat'),
          Icon: Send,
          onSelect: () => setShareToChatOpen(true),
        },
      ],
    })
    actionSections.push({
      header: t('dashboardPage.sectionDanger'),
      items: [
        {
          key: 'delete',
          label: t('dashboardPage.delete'),
          Icon: Trash2,
          onSelect: () => current && setDeleteTarget({ id: current.id, name: current.name }),
          danger: true,
        },
      ],
    })
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{t('dashboardPage.collections')}</p>
          <div className="mt-1 flex min-w-0 items-center gap-3">
            <h2 className="truncate font-display text-3xl font-bold text-ink">{t('dashboardPage.dashboards')}</h2>
            {live && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-accent">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                {t('dashboardPage.live')}
              </span>
            )}
            {current && !canEdit && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-soft">
                <Eye size={12} /> {t('dashboardPage.sharedReadOnly')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {current && canEdit && current.widgets.length > 0 && (
            <div className="flex h-9 shrink-0 items-center rounded-xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => toggleLive(current.id, !live).catch(() => undefined)}
                aria-pressed={live}
                aria-label={live ? t('dashboardPage.live') : t('dashboardPage.liveMode')}
                title={live ? t('dashboardPage.live') : t('dashboardPage.liveMode')}
                className={`grid h-full w-9 place-items-center rounded-l-xl transition ${
                  live ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <Radio size={16} className={live ? 'animate-pulse' : ''} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !timeMachineOpen
                  setTimeMachineOpen(next)
                  if (next) snapshots.load(current.id).catch(() => undefined)
                  else snapshots.clearSelection()
                }}
                aria-pressed={timeMachineOpen}
                aria-label={t('timeMachine.title')}
                title={t('timeMachine.title')}
                className={`grid h-full w-9 place-items-center rounded-r-xl border-l border-line transition ${
                  timeMachineOpen ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <History size={16} />
              </button>
            </div>
          )}
          {current && canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              aria-label={t('dashboardPage.addWidget')}
              title={t('dashboardPage.addWidget')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-ink-soft transition hover:border-accent hover:text-accent"
            >
              <Plus size={16} />
            </button>
          )}
          {current && canEdit && (
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              aria-pressed={chatOpen}
              aria-label={t('dashboardPage.team')}
              title={t('dashboardPage.team')}
              className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${
                chatOpen
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-accent hover:text-accent'
              }`}
            >
              <MessageCircle size={16} />
              {participants.length > 1 && (
                <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                  {participants.length}
                </span>
              )}
            </button>
          )}
          <ActionMenu
            triggerLabel=""
            triggerIcon={MoreHorizontal}
            ariaLabel={t('dashboardPage.moreActions')}
            triggerClassName="flex h-9 shrink-0 items-center gap-1 rounded-xl px-2.5"
            sections={actionSections}
          />
          <button
            type="button"
            onClick={() => setGenerateOpen(true)}
            aria-label={t('dashboardPage.buildWithAi')}
            title={t('dashboardPage.buildWithAi')}
            className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-accent/40 bg-accent-soft px-3 text-sm font-semibold text-accent transition hover:border-accent active:translate-y-px"
          >
            <Sparkles size={16} strokeWidth={2.5} />
            <span className="hidden lg:inline">{t('dashboardPage.buildWithAi')}</span>
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label={t('dashboardPage.new')}
            title={t('dashboardPage.new')}
            className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent px-3 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="hidden sm:inline">{t('dashboardPage.new')}</span>
          </button>
          {current && canEdit && (
            <ShareToChatButton
              resourceType="dashboard"
              resourceId={current.id}
              controlledOpen={shareToChatOpen}
              onOpenChange={setShareToChatOpen}
            />
          )}
        </div>
      </div>

      {list.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {list.map((d) => (
            <button
              key={d.id}
              onClick={() => open(d.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setPillMenu({ x: e.clientX, y: e.clientY, id: d.id, name: d.name })
              }}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                current?.id === d.id
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-soft hover:border-accent hover:text-ink'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {current && timeMachineOpen && (
        <SnapshotTimeline
          items={snapshots.items}
          selectedId={snapshots.selected?.id ?? null}
          capturing={snapshots.capturing}
          loading={snapshots.loading}
          onCapture={() => snapshots.capture(current.id).catch(() => undefined)}
          onSelect={(sid) => snapshots.select(current.id, sid).catch(() => undefined)}
          onClear={snapshots.clearSelection}
          onDelete={(sid) => snapshots.remove(current.id, sid).catch(() => undefined)}
        />
      )}

      {current ? (
        timeMachineOpen && snapshots.selected ? (
          <SnapshotView snapshot={snapshots.selected} dashboard={current} />
        ) : current.widgets.length ? (
          <CollabSurface>
            <DashboardGrid
              dashboard={current}
              onRemoveWidget={(wid) => removeWidget(current.id, wid).catch(() => undefined)}
              onRefreshWidget={(wid) => refreshWidget(current.id, wid).catch(() => undefined)}
              onLayoutChange={onLayoutChange}
              readOnly={!canEdit}
            />
          </CollabSurface>
        ) : (
          <EmptyDashboard onAdd={() => setAddOpen(true)} />
        )
      ) : (
        <EmptyState />
      )}

      {story && current && (
        <StoryMode story={story} widgets={current.widgets} onClose={() => setStory(null)} />
      )}

      {printing && current && (
        <DashboardPrintView dashboard={current} onReady={printWhenReady} />
      )}

      <CollabPanel open={chatOpen} onClose={() => setChatOpen(false)} />

      <SaveDashboardModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={async (name) => {
          const dash = await create(name)
          await open(dash.id)
          setCreateOpen(false)
        }}
      />

      <GenerateDashboardModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerate={async (goal) => {
          try {
            const dash = await generate(goal, null)
            setGenerateOpen(false)
            toast.success(t('dashboardPage.generatedToast', { name: dash.name, count: dash.widgets.length }))
          } catch {
            /* interceptor toast */
          }
        }}
      />

      {current && (
        <ShareDashboardModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          dashboardId={current.id}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await remove(deleteTarget.id)
        }}
        title={t('dashboardPage.deleteTitle')}
        message={t('dashboardPage.deleteMessage', { name: deleteTarget?.name ?? '' })}
      />

      {pillMenu && (
        <PillContextMenu
          x={pillMenu.x}
          y={pillMenu.y}
          onOpen={() => {
            open(pillMenu.id).catch(() => undefined)
            setPillMenu(null)
          }}
          onDelete={() => {
            setDeleteTarget({ id: pillMenu.id, name: pillMenu.name })
            setPillMenu(null)
          }}
          onClose={() => setPillMenu(null)}
        />
      )}

      {current && (
        <AddWidgetModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onPick={async (item) => {
            await addWidget(current.id, item.id, item.natural_language)
            toast.success(t('dashboardPage.widgetAdded'))
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <LayoutGrid size={28} className="mx-auto text-ink-faint" />
      <p className="mt-3 font-display text-lg text-ink">{t('dashboardPage.emptySelectTitle')}</p>
      <p className="mt-1 text-sm text-ink-soft">{t('dashboardPage.emptySelectDesc')}</p>
    </div>
  )
}

function EmptyDashboard({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-lg text-ink">{t('dashboardPage.emptyPanelTitle')}</p>
      <p className="mt-1 text-sm text-ink-soft">{t('dashboardPage.emptyPanelDesc')}</p>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
      >
        <Plus size={16} strokeWidth={2.5} /> {t('dashboardPage.addWidget')}
      </button>
    </div>
  )
}

/** Cursor-anchored right-click menu for a dashboard pill: open or delete it.
 *  Closes on outside click, Escape, scroll, or resize. */
function PillContextMenu({
  x,
  y,
  onOpen,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  onOpen: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Mounted only while open. Cursor-anchored, so there is no trigger to track.
  useReflowDismiss(true, onClose)

  // Keep the menu inside the viewport when the click lands near an edge.
  const MENU_W = 160
  const MENU_H = 92
  const left = Math.min(x, window.innerWidth - MENU_W - 8)
  const top = Math.min(y, window.innerHeight - MENU_H - 8)

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top, left, zIndex: 60, minWidth: MENU_W }}
      className="overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg"
    >
      <button
        role="menuitem"
        onClick={onOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-2"
      >
        <Eye size={14} /> {t('dashboardPage.open')}
      </button>
      <button
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#D87C6B] transition hover:bg-surface-2"
      >
        <Trash2 size={14} /> {t('dashboardPage.delete')}
      </button>
    </div>
  )
}
