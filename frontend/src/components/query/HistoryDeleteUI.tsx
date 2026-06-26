import { Trash2 } from 'lucide-react'
import { ContextMenu } from '../ui/ContextMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { useHistoryDelete } from '../../hooks/useHistoryDelete'

/** Renders the right-click menu + delete confirmation for history items.
 *  Pair with the `useHistoryDelete` hook; place once per page. */
export function HistoryDeleteUI({ del }: { del: ReturnType<typeof useHistoryDelete> }) {
  return (
    <>
      {del.menu && (
        <ContextMenu
          x={del.menu.x}
          y={del.menu.y}
          onClose={del.closeMenu}
          items={[
            {
              label: 'Sil',
              icon: Trash2,
              destructive: true,
              onSelect: () => del.askDelete(del.menu!.id),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!del.confirmId}
        onClose={del.cancelDelete}
        onConfirm={del.confirmDelete}
        title="Sorğunu sil"
        message="Bu sorğu tarixçədən silinəcək. Bunu geri qaytarmaq olmaz."
      />
    </>
  )
}
