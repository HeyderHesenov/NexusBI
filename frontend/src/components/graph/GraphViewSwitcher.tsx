import { useTranslation } from 'react-i18next'
import { Eye, LayoutGrid, MoreHorizontal, Pencil, Plus, PlusCircle, Share2, Trash2 } from 'lucide-react'
import { Dropdown } from '../ui/Dropdown'
import { ActionMenu, type ActionMenuItem } from '../ui/ActionMenu'
import type { GraphView } from '../../types'

// Shared trigger sizing so toolbar menus match the Dropdown / buttons (h-9).
export const GRAPH_MENU_TRIGGER =
  'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors'

interface Props {
  views: GraphView[]
  activeViewId: string | null
  /** Full graph has locally-hidden nodes/edges (enables "show all"). */
  fullHasHidden: boolean
  onSelect: (id: string | null) => void
  onNew: () => void
  onAddAssets: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onShowAll: () => void
}

/** Toolbar control to switch between the full graph and saved custom graphs.
 *  Selecting is a Dropdown; creating is a primary "+" button; managing the active
 *  view (add / rename / restore / delete) lives in a contextual kebab menu that
 *  only appears when there's something to manage. */
export function GraphViewSwitcher({
  views,
  activeViewId,
  fullHasHidden,
  onSelect,
  onNew,
  onAddAssets,
  onRename,
  onDelete,
  onShowAll,
}: Props) {
  const { t } = useTranslation()
  const activeView = views.find((v) => v.id === activeViewId) ?? null
  const hasHidden = activeView
    ? activeView.hidden_node_ids.length > 0 || activeView.hidden_edge_keys.length > 0
    : fullHasHidden

  // Contextual manage items. Empty ⇒ ActionMenu renders nothing (self-hides).
  const items: ActionMenuItem[] = []
  if (activeView) {
    items.push({ key: 'add', label: t('graphPage.views.addAssets'), Icon: PlusCircle, onSelect: onAddAssets })
    items.push({
      key: 'rename',
      label: t('graphPage.views.rename'),
      Icon: Pencil,
      onSelect: () => onRename(activeView.id, activeView.name),
    })
  }
  if (hasHidden) {
    items.push({ key: 'showAll', label: t('graphPage.views.showAll'), Icon: Eye, onSelect: onShowAll })
  }
  if (activeView) {
    items.push({
      key: 'delete',
      label: t('graphPage.views.delete'),
      Icon: Trash2,
      onSelect: () => onDelete(activeView.id),
    })
  }

  const options = [
    { value: '', label: t('graphPage.views.full'), Icon: Share2 },
    ...views.map((v) => ({ value: v.id, label: v.name, Icon: LayoutGrid })),
  ]

  return (
    <div className="flex items-center gap-1.5">
      <Dropdown
        value={activeViewId ?? ''}
        onChange={(v) => onSelect(v || null)}
        ariaLabel={t('graphPage.views.label')}
        options={options}
        className="w-44"
      />
      <button
        type="button"
        onClick={onNew}
        aria-label={t('graphPage.views.new')}
        title={t('graphPage.views.new')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-ink-soft transition hover:border-accent hover:text-accent"
      >
        <Plus size={16} />
      </button>
      <ActionMenu
        triggerLabel=""
        triggerIcon={MoreHorizontal}
        ariaLabel={t('graphPage.views.manage')}
        triggerClassName={`${GRAPH_MENU_TRIGGER} !px-2.5`}
        sections={[{ header: t('graphPage.views.label'), items }]}
      />
    </div>
  )
}
