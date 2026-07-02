import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Crosshair, RefreshCw } from 'lucide-react'
import { ForceGraph, TYPE_COLOR } from '../components/graph/ForceGraph'
import { impactSet, selectedNode, useGraphStore } from '../store/graphStore'
import type { GraphNodeType } from '../types'

const NODE_ROUTE: Record<GraphNodeType, string> = {
  ds: '/sources',
  table: '/sources',
  metric: '/metrics',
  mnode: '/metric-tree',
  dash: '/dashboards',
  widget: '/dashboards',
  squery: '/reports',
  decision: '/decisions',
}

const LEGEND = Object.keys(TYPE_COLOR) as GraphNodeType[]

export function GraphPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, loading, error, selectedId, impactMode, load, select, toggleImpact } =
    useGraphStore()

  useEffect(() => {
    void load()
  }, [load])

  const node = selectedNode(data, selectedId)
  const highlight = useMemo(() => {
    if (!impactMode || !data || !selectedId) return null
    return impactSet(data, selectedId)
  }, [impactMode, data, selectedId])

  return (
    <div className="mx-auto w-full">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('graphPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
            {t('graphPage.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t('graphPage.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={toggleImpact}
          aria-pressed={impactMode}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition ${
            impactMode
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-ink-soft hover:border-accent hover:text-ink'
          }`}
        >
          <Crosshair size={15} />
          {t('graphPage.impactMode')}
        </button>
      </header>

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
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <ForceGraph
              data={data}
              selectedId={selectedId}
              highlight={highlight}
              onSelect={select}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft">
              {LEGEND.map((type) => (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: TYPE_COLOR[type] }}
                  />
                  {t(`graphPage.type.${type}`)}
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-faint">{t('graphPage.hint')}</p>
          </div>
          {node && (
            <aside className="w-full shrink-0 rounded-2xl border border-line bg-surface p-4 lg:w-64">
              <p className="eyebrow">{t(`graphPage.type.${node.type}`)}</p>
              <h2 className="mt-1 break-words font-display text-lg font-bold text-ink">
                {node.label}
              </h2>
              {impactMode && highlight && (
                <p className="mt-2 text-xs text-ink-soft">
                  {t('graphPage.impactCount', { count: highlight.size - 1 })}
                </p>
              )}
              <button
                type="button"
                onClick={() => navigate(NODE_ROUTE[node.type] ?? '/')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
              >
                <ArrowUpRight size={14} />
                {t('graphPage.open')}
              </button>
            </aside>
          )}
        </div>
      ) : (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <p className="font-display text-lg text-ink">{t('graphPage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('graphPage.emptyBody')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
