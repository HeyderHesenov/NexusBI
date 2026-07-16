import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import { GLYPH, TYPE_ICON } from './ForceGraph'
import { GRAPH_TYPE_COLORS } from '../charts/theme'
import { useGraphStore } from '../../store/graphStore'
import type { GraphNode, GraphNodeType } from '../../types'

// Stable grouping order for the asset list (sources first, leaves last).
const TYPE_ORDER: GraphNodeType[] = [
  'ds', 'table', 'column', 'metric', 'mnode', 'widget', 'dash', 'squery', 'decision',
]

interface Props {
  open: boolean
  /** 'new' → create a graph from the picked assets; 'add' → add to the active view. */
  mode: 'new' | 'add'
  onClose: () => void
}

/** Categorized multi-select of the full graph's assets. Powers both "new graph
 *  from 0" and "add assets to the active graph". */
export function GraphAssetPickerModal({ open, mode, onClose }: Props) {
  const { t } = useTranslation()
  const data = useGraphStore((s) => s.data)
  const views = useGraphStore((s) => s.views)
  const activeViewId = useGraphStore((s) => s.activeViewId)
  const createView = useGraphStore((s) => s.createView)
  const addAssets = useGraphStore((s) => s.addAssets)

  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (open) {
      setName('')
      setSelected(new Set())
      setBusy(false)
    }
  }, [open, mode])

  // Assets available to pick: the full graph, minus what the active view already
  // includes (in 'add' mode) so the list only shows genuinely new nodes.
  const available = useMemo(() => {
    const nodes = data?.nodes ?? []
    if (mode === 'add') {
      const view = views.find((v) => v.id === activeViewId)
      const already = new Set(view?.included_node_ids ?? [])
      return nodes.filter((n) => !already.has(n.id))
    }
    return nodes
  }, [data, views, activeViewId, mode])

  const groups = useMemo(() => {
    const byType = new Map<GraphNodeType, GraphNode[]>()
    for (const n of available) {
      const list = byType.get(n.type)
      if (list) list.push(n)
      else byType.set(n.type, [n])
    }
    return TYPE_ORDER.filter((ty) => byType.has(ty)).map((ty) => ({
      type: ty,
      nodes: byType.get(ty)!.sort((a, b) => a.label.localeCompare(b.label)),
    }))
  }, [available])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const canSubmit =
    mode === 'new' ? name.trim().length > 0 : selected.size > 0

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      if (mode === 'new') {
        await createView(name.trim(), Array.from(selected))
        toast.success(t('graphPage.newGraph.created'))
      } else {
        await addAssets(Array.from(selected))
        toast.success(t('graphPage.addAssets.added', { count: selected.size }))
      }
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      wide
      title={t(mode === 'new' ? 'graphPage.newGraph.title' : 'graphPage.addAssets.title')}
      subtitle={t(mode === 'new' ? 'graphPage.newGraph.subtitle' : 'graphPage.addAssets.subtitle')}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint">
            {t('graphPage.addAssets.selected', { count: selected.size })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
            >
              {t('confirmDialog.cancel')}
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit || busy}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
            >
              {busy
                ? '…'
                : t(mode === 'new' ? 'graphPage.newGraph.confirm' : 'graphPage.addAssets.confirm')}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {mode === 'new' && (
          <div>
            <label htmlFor="graph-view-name" className="mb-1 block text-sm font-medium text-ink">
              {t('graphPage.views.nameLabel')}
            </label>
            <input
              id="graph-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('graphPage.views.namePlaceholder')}
              maxLength={255}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
        )}

        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-faint">{t('graphPage.addAssets.empty')}</p>
        ) : (
          <div className="space-y-3">
            {groups.map(({ type, nodes }) => (
              <div key={type}>
                <p className="eyebrow mb-1.5">{t(`graphPage.type.${type}`)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {nodes.map((n) => {
                    const on = selected.has(n.id)
                    const Icon = TYPE_ICON[n.type]
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => toggle(n.id)}
                        aria-pressed={on}
                        className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          on
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-line text-ink-soft hover:border-accent hover:text-ink'
                        }`}
                      >
                        <span
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-full"
                          style={{ background: GRAPH_TYPE_COLORS[n.type] }}
                        >
                          <Icon size={10} color={GLYPH} strokeWidth={2.4} />
                        </span>
                        <span className="truncate">{n.label}</span>
                        {on && <Check size={13} className="shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  )
}
