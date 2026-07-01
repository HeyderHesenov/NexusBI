import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenu } from '../ui/ContextMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { useHistoryDelete } from '../../hooks/useHistoryDelete'

/** Renders the right-click menu + delete confirmation for history items.
 *  Pair with the `useHistoryDelete` hook; place once per page. */
export function HistoryDeleteUI({ del }: { del: ReturnType<typeof useHistoryDelete> }) {
  const { t } = useTranslation()
  return (
    <>
      {del.menu && (
        <ContextMenu
          x={del.menu.x}
          y={del.menu.y}
          onClose={del.closeMenu}
          items={[
            {
              label: t('historyDeleteUI.delete'),
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
        title={t('historyDeleteUI.confirmTitle')}
        message={t('historyDeleteUI.confirmMessage')}
      />
    </>
  )
}
