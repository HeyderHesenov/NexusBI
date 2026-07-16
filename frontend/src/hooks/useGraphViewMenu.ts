import { useState } from 'react'

/** What a graph context menu was opened on. */
export type GraphMenuTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edge: { source: string; target: string; kind: string } }
  | { kind: 'canvas' }

export interface GraphMenu {
  x: number
  y: number
  target: GraphMenuTarget
}

/** Shared right-click + modal state for the graph-view editor. Mirrors
 *  `useHistoryDelete`: the hook owns transient UI state, the paired
 *  `GraphContextMenus` renders it and calls the store actions. */
export function useGraphViewMenu() {
  const [menu, setMenu] = useState<GraphMenu | null>(null)
  const [modal, setModal] = useState<'new' | 'add' | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const openNodeMenu = (nodeId: string, e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'node', nodeId } })
  }
  const openEdgeMenu = (
    edge: { source: string; target: string; kind: string },
    e: React.MouseEvent,
  ) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'edge', edge } })
  }
  const openCanvasMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, target: { kind: 'canvas' } })
  }

  return {
    menu,
    closeMenu: () => setMenu(null),
    modal,
    openModal: (m: 'new' | 'add') => setModal(m),
    closeModal: () => setModal(null),
    confirmDeleteId,
    askDeleteGraph: (id: string) => setConfirmDeleteId(id),
    cancelDeleteGraph: () => setConfirmDeleteId(null),
    renaming,
    startRename: (id: string, name: string) => setRenaming({ id, name }),
    cancelRename: () => setRenaming(null),
    openNodeMenu,
    openEdgeMenu,
    openCanvasMenu,
  }
}

export type GraphViewMenu = ReturnType<typeof useGraphViewMenu>
