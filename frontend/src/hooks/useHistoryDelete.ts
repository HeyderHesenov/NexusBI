import { useState } from 'react'
import { useQueryStore } from '../store/queryStore'

export interface HistoryMenu {
  id: string
  x: number
  y: number
}

/** Shared right-click + confirm state for deleting a query from history.
 *  Consumed by both the QueryPage sidebar and the HistoryPage table. */
export function useHistoryDelete() {
  const deleteHistoryItem = useQueryStore((s) => s.deleteHistoryItem)
  const [menu, setMenu] = useState<HistoryMenu | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const openMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ id, x: e.clientX, y: e.clientY })
  }

  return {
    menu,
    confirmId,
    openMenu,
    closeMenu: () => setMenu(null),
    askDelete: (id: string) => setConfirmId(id),
    cancelDelete: () => setConfirmId(null),
    confirmDelete: async () => {
      if (confirmId) await deleteHistoryItem(confirmId)
    },
  }
}
