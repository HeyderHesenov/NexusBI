import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Expand, Minimize2, RefreshCw } from 'lucide-react'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { PageHeader } from '../components/ui/PageHeader'
import { GraphViewSwitcher } from '../components/graph/GraphViewSwitcher'
import { GraphContextMenus } from '../components/graph/GraphContextMenus'
import { useGraphViewMenu } from '../hooks/useGraphViewMenu'
import {
  activeViewConfig,
  impactSet,
  pathBetween,
  selectedNode,
  upstreamSet,
  useGraphStore,
  viewGraph,
} from '../store/graphStore'
import type { GraphNodeType } from '../types'

export function GraphPage() {
  const { t } = useTranslation()
  const {
    data,
    loading,
    error,
    selectedId,
    impactMode,
    impactDir,
    pathMode,
    pathSource,
    pathTarget,
    views,
    activeViewId,
    fullHidden,
    load,
    select,
    toggleImpact,
    setImpactDir,
    togglePathMode,
    pickPathNode,
    clearPath,
    loadViews,
    setActiveView,
    showAll,
  } = useGraphStore()
  const vm = useGraphViewMenu()

  const [hiddenTypes, setHiddenTypes] = useState<Set<GraphNodeType>>(new Set())
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set())
  const [unhealthyOnly, setUnhealthyOnly] = useState(false)
  const [fs, setFs] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void load()
    void loadViews()
  }, [load, loadViews])

  // The active view is a pure filter over the single derived graph. Everything
  // below (canvas, impact/path, aside) works on this filtered subgraph; the full
  // `data` is used only for the empty-state guard and the asset picker.
  const viewConfig = activeViewConfig({ views, activeViewId, fullHidden })
  const viewData = useMemo(
    () => (data ? viewGraph(data, viewConfig) : null),
    [data, viewConfig],
  )

  // Fullscreen overlay: lock body scroll, move focus into the dialog, and close
  // on Esc — but let Esc clear/blur the search input first (don't close then).
  useEffect(() => {
    if (!fs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    overlayRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(document.activeElement instanceof HTMLInputElement)) {
        setFs(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [fs])

  const node = selectedNode(viewData, selectedId)

  const pathActive = pathMode && !!pathSource && !!pathTarget
  // {nodes, edges} when connected, null when the two picks don't reach each other.
  const path = useMemo(() => {
    if (!viewData || !pathSource || !pathTarget) return null
    return pathBetween(viewData, pathSource, pathTarget)
  }, [viewData, pathSource, pathTarget])

  const highlight = useMemo(() => {
    // Path highlight wins; a disconnected pair dims nothing (the aside says why).
    if (pathActive) return path ? new Set(path.nodes) : null
    if (!impactMode || !viewData || !selectedId) return null
    if (impactDir === 'up') return upstreamSet(viewData, selectedId)
    if (impactDir === 'both')
      return new Set([...impactSet(viewData, selectedId), ...upstreamSet(viewData, selectedId)])
    return impactSet(viewData, selectedId)
  }, [pathActive, path, impactMode, viewData, selectedId, impactDir])

  const pathEdgeKeys = pathActive && path ? path.edges : null

  // While picking a path, a node click chooses an endpoint instead of selecting.
  const onSelectNode = (id: string | null) => {
    if (pathMode && id) pickPathNode(id)
    else select(id)
  }

  const toggleType = (type: GraphNodeType) => {
    // Hiding the selected node's type would strand an off-canvas selection
    // (aside + impact count for a node that isn't drawn) — clear it.
    if (node && node.type === type && !hiddenTypes.has(type)) select(null)
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleKind = (kind: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const fullscreenButton = (
    <button
      type="button"
      onClick={() => setFs(true)}
      aria-label={t('graphPage.fullscreen')}
      title={t('graphPage.fullscreen')}
      className="grid h-9 w-9 place-items-center rounded-xl border border-line text-ink-soft transition hover:border-accent hover:text-accent"
    >
      <Expand size={16} />
    </button>
  )
  const exitButton = (
    <button
      type="button"
      onClick={() => setFs(false)}
      aria-label={t('graphPage.exitFullscreen')}
      title={t('graphPage.exitFullscreen')}
      className="grid h-9 w-9 place-items-center rounded-xl border border-accent bg-accent-soft text-accent transition hover:bg-accent hover:text-bg"
    >
      <Minimize2 size={16} />
    </button>
  )

  const viewSwitcher = (
    <GraphViewSwitcher
      views={views}
      activeViewId={activeViewId}
      fullHasHidden={fullHidden.nodes.length > 0 || fullHidden.edges.length > 0}
      onSelect={setActiveView}
      onNew={() => vm.openModal('new')}
      onAddAssets={() => vm.openModal('add')}
      onRename={vm.startRename}
      onDelete={vm.askDeleteGraph}
      onShowAll={() => void showAll()}
    />
  )

  const sharedProps = {
    data: viewData!,
    selectedId,
    highlight,
    pathEdgeKeys,
    impactMode,
    impactDir,
    pathMode,
    pathActive,
    pathLength: path ? path.nodes.length : null,
    hiddenTypes,
    hiddenKinds,
    unhealthyOnly,
    onSelect: onSelectNode,
    onToggleImpact: toggleImpact,
    onSetImpactDir: setImpactDir,
    onTogglePathMode: togglePathMode,
    onClearPath: clearPath,
    onToggleUnhealthy: () => setUnhealthyOnly((v) => !v),
    onToggleType: toggleType,
    onToggleKind: toggleKind,
    viewSwitcher,
    onNodeContextMenu: vm.openNodeMenu,
    onEdgeContextMenu: vm.openEdgeMenu,
    onCanvasContextMenu: vm.openCanvasMenu,
  }

  return (
    <div className="mx-auto w-full">
      <PageHeader
        eyebrow={t('graphPage.eyebrow')}
        title={t('graphPage.title')}
        subtitle={t('graphPage.subtitle')}
      />

      {loading && !data ? (
        <div className="grid min-h-[55vh] place-items-center text-sm text-ink-faint">
          {t('common.loading')}
        </div>
      ) : error && !data ? (
        <div className="grid min-h-[55vh] place-items-center text-center">
          <div>
            <p className="text-sm text-ink-soft">{t('graphPage.error')}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              <RefreshCw size={14} /> {t('common.retry')}
            </button>
          </div>
        </div>
      ) : data && data.nodes.length > 1 ? (
        // Single GraphCanvas the whole time — `contents` makes the wrapper
        // transparent inline and a full-viewport dialog in fullscreen, so
        // toggling never remounts (zoom/pan + search survive the switch).
        <div
          ref={overlayRef}
          role={fs ? 'dialog' : undefined}
          aria-modal={fs ? true : undefined}
          aria-label={fs ? t('graphPage.title') : undefined}
          tabIndex={fs ? -1 : undefined}
          className={
            fs
              ? 'fixed inset-0 z-50 flex flex-col overflow-auto bg-bg/95 p-4 outline-none backdrop-blur-xl sm:p-6'
              : 'contents'
          }
        >
          <GraphCanvas
            {...sharedProps}
            svgClassName={fs ? 'min-h-0 flex-1' : undefined}
            toolbarExtra={fs ? exitButton : fullscreenButton}
            onNavigateAway={fs ? () => setFs(false) : undefined}
          />
        </div>
      ) : (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <p className="font-display text-lg text-ink">{t('graphPage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('graphPage.emptyBody')}</p>
          </div>
        </div>
      )}

      <GraphContextMenus vm={vm} />
    </div>
  )
}
