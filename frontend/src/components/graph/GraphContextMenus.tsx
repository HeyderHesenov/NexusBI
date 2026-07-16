import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EyeOff, Plus, PlusCircle } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ModalShell } from '../ui/ModalShell'
import { GraphAssetPickerModal } from './GraphAssetPickerModal'
import { useGraphStore } from '../../store/graphStore'
import type { GraphViewMenu } from '../../hooks/useGraphViewMenu'

/** Renders the graph right-click menu, rename modal, delete-graph confirmation,
 *  and the asset picker. Pair with `useGraphViewMenu`; place once per page. */
export function GraphContextMenus({ vm }: { vm: GraphViewMenu }) {
  const { t } = useTranslation()
  const views = useGraphStore((s) => s.views)
  const activeViewId = useGraphStore((s) => s.activeViewId)
  const removeNode = useGraphStore((s) => s.removeNode)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const deleteView = useGraphStore((s) => s.deleteView)
  const renameView = useGraphStore((s) => s.renameView)

  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  useEffect(() => {
    if (vm.renaming) setRenameValue(vm.renaming.name)
  }, [vm.renaming])

  const activeIsNamed = !!views.find((v) => v.id === activeViewId)

  let items: ContextMenuItem[] = []
  const target = vm.menu?.target
  if (target?.kind === 'node') {
    const { nodeId } = target
    items = [
      { label: t('graphPage.menu.removeNode'), icon: EyeOff, onSelect: () => void removeNode(nodeId) },
    ]
  } else if (target?.kind === 'edge') {
    const { source, target: tgt, kind } = target.edge
    items = [
      {
        label: t('graphPage.menu.removeEdge'),
        icon: EyeOff,
        onSelect: () => void removeEdge(source, tgt, kind),
      },
    ]
  } else if (target?.kind === 'canvas') {
    items = [{ label: t('graphPage.menu.newGraph'), icon: Plus, onSelect: () => vm.openModal('new') }]
    if (activeIsNamed) {
      items.push({
        label: t('graphPage.menu.addAssets'),
        icon: PlusCircle,
        onSelect: () => vm.openModal('add'),
      })
    }
  }

  const saveRename = async () => {
    if (!vm.renaming || !renameValue.trim()) return
    setRenameBusy(true)
    try {
      await renameView(vm.renaming.id, renameValue.trim())
      vm.cancelRename()
    } catch {
      /* interceptor toast */
    } finally {
      setRenameBusy(false)
    }
  }

  return (
    <>
      {vm.menu && items.length > 0 && (
        <ContextMenu x={vm.menu.x} y={vm.menu.y} onClose={vm.closeMenu} items={items} />
      )}

      <ConfirmDialog
        open={!!vm.confirmDeleteId}
        onClose={vm.cancelDeleteGraph}
        onConfirm={() => (vm.confirmDeleteId ? deleteView(vm.confirmDeleteId) : undefined)}
        title={t('graphPage.deleteGraphConfirm.title')}
        message={t('graphPage.deleteGraphConfirm.message')}
      />

      <ModalShell
        open={!!vm.renaming}
        onClose={vm.cancelRename}
        title={t('graphPage.views.rename')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={vm.cancelRename}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
            >
              {t('confirmDialog.cancel')}
            </button>
            <button
              onClick={saveRename}
              disabled={!renameValue.trim() || renameBusy}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
            >
              {renameBusy ? '…' : t('graphPage.views.save')}
            </button>
          </div>
        }
      >
        <div className="p-5">
          <label htmlFor="graph-rename" className="mb-1 block text-sm font-medium text-ink">
            {t('graphPage.views.nameLabel')}
          </label>
          <input
            id="graph-rename"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveRename()
            }}
            maxLength={255}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
        </div>
      </ModalShell>

      <GraphAssetPickerModal open={!!vm.modal} mode={vm.modal ?? 'new'} onClose={vm.closeModal} />
    </>
  )
}
