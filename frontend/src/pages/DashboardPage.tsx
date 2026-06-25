import { LayoutGrid, Plus, RefreshCw, Share2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { Layouts } from 'react-grid-layout'
import { AddWidgetModal } from '../components/dashboard/AddWidgetModal'
import { DashboardGrid } from '../components/dashboard/DashboardGrid'
import { SaveDashboardModal } from '../components/dashboard/SaveDashboardModal'
import { ShareDashboardModal } from '../components/dashboard/ShareDashboardModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useDashboardStore } from '../store/dashboardStore'

export function DashboardPage() {
  const {
    list, current, refreshing, loadList, open, create, remove,
    addWidget, removeWidget, refreshWidget, refreshAll, saveLayout,
  } = useDashboardStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    loadList().catch(() => undefined)
  }, [loadList])

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
          <p className="eyebrow">Kolleksiyalar</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">Dashboard-lar</h2>
        </div>
        <div className="flex gap-2">
          {current && current.widgets.length > 0 && (
            <button
              onClick={() => refreshAll(current.id)}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Hamısını yenilə
            </button>
          )}
          {current && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <Plus size={16} /> Widget
            </button>
          )}
          {current && (
            <button
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
            >
              <Share2 size={16} /> Paylaş
            </button>
          )}
          {current && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
            >
              <Trash2 size={16} /> Sil
            </button>
          )}
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            <Plus size={16} strokeWidth={2.5} /> Yeni
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

      {current ? (
        current.widgets.length ? (
          <DashboardGrid
            dashboard={current}
            onRemoveWidget={(wid) => removeWidget(current.id, wid).catch(() => undefined)}
            onRefreshWidget={(wid) => refreshWidget(current.id, wid).catch(() => undefined)}
            onLayoutChange={onLayoutChange}
          />
        ) : (
          <EmptyDashboard onAdd={() => setAddOpen(true)} />
        )
      ) : (
        <EmptyState />
      )}

      <SaveDashboardModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={async (name) => {
          const dash = await create(name)
          await open(dash.id)
          setCreateOpen(false)
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
          title="Dashboard-u sil"
          message={`“${current.name}” paneli və bütün widgetləri həmişəlik silinəcək. Bu əməliyyat geri qaytarıla bilməz.`}
        />
      )}

      {current && (
        <AddWidgetModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onPick={async (item) => {
            await addWidget(current.id, item.id, item.natural_language)
            toast.success('Widget əlavə olundu.')
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <LayoutGrid size={28} className="mx-auto text-ink-faint" />
      <p className="mt-3 font-display text-lg text-ink">Dashboard seç və ya yarat</p>
      <p className="mt-1 text-sm text-ink-soft">Sorğularını bir yerə yığıb canlı panel düzəlt.</p>
    </div>
  )
}

function EmptyDashboard({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-lg text-ink">Bu panel boşdur</p>
      <p className="mt-1 text-sm text-ink-soft">Tarixçədən sorğu seçib widget əlavə et.</p>
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
      >
        <Plus size={16} strokeWidth={2.5} /> Widget əlavə et
      </button>
    </div>
  )
}
