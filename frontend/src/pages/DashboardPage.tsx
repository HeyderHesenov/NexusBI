import { History, LayoutGrid, MessageCircle, Plus, Presentation, Radio, RefreshCw, Share2, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import type { Layouts } from 'react-grid-layout'
import type { DataStory } from '../types'
import { StoryMode } from '../components/story/StoryMode'
import { AddWidgetModal } from '../components/dashboard/AddWidgetModal'
import { CollabPanel } from '../components/dashboard/CollabPanel'
import { CollabSurface } from '../components/dashboard/CollabSurface'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { GenerateDashboardModal } from '../components/dashboard/GenerateDashboardModal'
import { SaveDashboardModal } from '../components/dashboard/SaveDashboardModal'
import { ShareDashboardModal } from '../components/dashboard/ShareDashboardModal'
import { SnapshotTimeline } from '../components/dashboard/SnapshotTimeline'
import { SnapshotView } from '../components/dashboard/SnapshotView'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { buildStory, getComments, getWsTicket } from '../api/dashboard'
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
  const [createOpen, setCreateOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [story, setStory] = useState<DataStory | null>(null)
  const [storyLoading, setStoryLoading] = useState(false)
  const [timeMachineOpen, setTimeMachineOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const { participants, connect, disconnect } = useCollabStore()
  const snapshots = useSnapshotStore()

  useEffect(() => {
    loadList().catch(() => undefined)
  }, [loadList])

  // Join the live collaboration room for whichever dashboard is open.
  const currentId = current?.id

  // Reset the time machine when switching dashboards.
  const snapshotsReset = snapshots.reset
  useEffect(() => {
    setTimeMachineOpen(false)
    snapshotsReset()
  }, [currentId, snapshotsReset])
  useEffect(() => {
    if (!currentId) return
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
  }, [currentId, connect, disconnect])

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
    if (!current) return
    const id = current.id
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveLayout(id, layouts as unknown as Record<string, unknown>).catch(() => undefined)
    }, 800)
  }

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('dashboardPage.collections')}</p>
          <div className="mt-1 flex items-center gap-3">
            <h2 className="font-display text-3xl font-bold text-ink">{t('dashboardPage.dashboards')}</h2>
            {live && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-accent">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                {t('dashboardPage.live')}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {current && current.widgets.length > 0 && (
            <button
              onClick={() => toggleLive(current.id, !live).catch(() => undefined)}
              className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                live
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-accent hover:text-ink'
              }`}
            >
              <Radio size={16} className={live ? 'animate-pulse' : ''} />
              {live ? t('dashboardPage.live') : t('dashboardPage.liveMode')}
            </button>
          )}
          {current && current.widgets.length > 0 && (
            <button
              onClick={() => {
                const next = !timeMachineOpen
                setTimeMachineOpen(next)
                if (next) snapshots.load(current.id).catch(() => undefined)
                else snapshots.clearSelection()
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition ${
                timeMachineOpen
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-soft hover:border-accent hover:text-ink'
              }`}
            >
              <History size={16} /> {t('timeMachine.title')}
            </button>
          )}
          {current && current.widgets.length > 0 && (
            <button
              onClick={openStory}
              disabled={storyLoading}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-50"
            >
              <Presentation size={16} className={storyLoading ? 'animate-pulse' : ''} />
              {storyLoading ? t('dashboardPage.preparing') : t('dashboardPage.story')}
            </button>
          )}
          {current && current.widgets.length > 0 && (
            <button
              onClick={() => refreshAll(current.id)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> {t('dashboardPage.refreshAll')}
            </button>
          )}
          {current && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <Plus size={16} /> {t('dashboardPage.widget')}
            </button>
          )}
          {current && (
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="relative flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <MessageCircle size={16} /> {t('dashboardPage.team')}
              {participants.length > 1 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                  {participants.length}
                </span>
              )}
            </button>
          )}
          {current && (
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <Share2 size={16} /> {t('dashboardPage.share')}
            </button>
          )}
          {current && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
            >
              <Trash2 size={16} /> {t('dashboardPage.delete')}
            </button>
          )}
          <button
            onClick={() => setGenerateOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:border-accent active:translate-y-px"
          >
            <Sparkles size={16} strokeWidth={2.5} /> {t('dashboardPage.buildWithAi')}
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            <Plus size={16} strokeWidth={2.5} /> {t('dashboardPage.new')}
          </button>
        </div>
      </div>

      {list.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          {list.map((d) => (
            <button
              key={d.id}
              onClick={() => open(d.id)}
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

      {current && (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => remove(current.id)}
          title={t('dashboardPage.deleteTitle')}
          message={t('dashboardPage.deleteMessage', { name: current.name })}
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
