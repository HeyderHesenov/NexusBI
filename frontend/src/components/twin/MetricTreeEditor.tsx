import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMetricTreeStore } from '../../store/metricTreeStore'
import { ModalShell } from '../ui/ModalShell'
import { Field, Select } from '../ui/form'
import { formatMetricValue as fmt } from '../../lib/format'
import { MetricValue, ProvenanceChip } from './ProvenanceChip'
import type {
  BindableSource,
  EvaluatedNode,
  MetricAgg,
  MetricNodeUpdate,
  SourceKind,
  TreeOperator,
} from '../../types'

const OP_SYMBOL: Record<string, string> = { add: '+', sub: '−', mul: '×', div: '÷' }
const AGGS: MetricAgg[] = ['sum', 'avg', 'min', 'max', 'last', 'count']

type Binding = {
  source_kind: SourceKind
  saved_query_id: string | null
  value_column: string | null
  agg: MetricAgg | null
}

type ModalState =
  | { mode: 'add-root' }
  | { mode: 'add-child'; parentId: string }
  | {
      mode: 'edit'
      nodeId: string
      name: string
      operator: TreeOperator
      value: number | null
      binding: Binding
    }

/** Metric-tree builder — add/edit/remove KPI decomposition nodes. Lives inside the
 *  Digital Twin ("Ağac" tab); `onChange` lets the twin re-evaluate after any edit
 *  so the simulator reflects the new tree. */
export function MetricTreeEditor({ onChange }: { onChange?: () => void }) {
  const { t } = useTranslation()
  const { forest, sources, load, loadSources, add, edit, remove } = useMetricTreeStore()
  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => {
    load().catch(() => undefined)
    // Loaded alongside the tree rather than when the modal opens: the source
    // list decides whether the "measure from a query" option is offered at all,
    // and a picker that appears a beat after the dialog reads as a glitch.
    loadSources().catch(() => undefined)
  }, [load, loadSources])

  const handleRemove = async (id: string) => {
    await remove(id)
    onChange?.()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-ink-soft">{t('metricTreePage.subtitle')}</p>
        <button
          onClick={() => setModal({ mode: 'add-root' })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> {t('metricTreePage.rootMetric')}
        </button>
      </div>

      {forest.length === 0 ? (
        <div className="plot-grid grid min-h-[45vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <GitBranch size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">{t('metricTreePage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('metricTreePage.emptyDesc')}</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {forest.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              onAddChild={(id) => setModal({ mode: 'add-child', parentId: id })}
              onEdit={(node) =>
                setModal({
                  mode: 'edit',
                  nodeId: node.id,
                  name: node.name,
                  operator: node.operator as TreeOperator,
                  value: node.manual_value,
                  binding: {
                    source_kind: node.source_kind,
                    saved_query_id: node.saved_query_id,
                    value_column: node.value_column,
                    agg: node.agg,
                  },
                })
              }
              onRemove={handleRemove}
            />
          ))}
        </ul>
      )}

      {modal && (
        <NodeModal
          state={modal}
          sources={sources}
          onClose={() => setModal(null)}
          onSubmit={async (payload) => {
            if (modal.mode === 'edit') await edit(modal.nodeId, payload)
            else
              await add({
                ...payload,
                parent_id: modal.mode === 'add-child' ? modal.parentId : null,
              })
            onChange?.()
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

function TreeNode({
  node,
  depth,
  onAddChild,
  onEdit,
  onRemove,
}: {
  node: EvaluatedNode
  depth: number
  onAddChild: (id: string) => void
  onEdit: (n: EvaluatedNode) => void
  onRemove: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2"
        style={{ marginLeft: depth * 20 }}
      >
        {hasChildren && (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft font-mono text-sm font-bold text-accent">
            {OP_SYMBOL[node.operator] ?? '+'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium text-ink">{node.name}</span>
            <MetricValue
              value={node.value}
              format={fmt}
              className="font-display text-sm font-bold text-ink"
            />
            <ProvenanceChip node={node} />
            {node.contribution_pct != null && (
              <span className="font-mono text-[10px] text-ink-faint">{node.contribution_pct}%</span>
            )}
          </div>
          {node.contribution_pct != null && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(100, Math.abs(node.contribution_pct))}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => onAddChild(node.id)}
            aria-label={t('metricTreePage.childNode')}
            title={t('metricTreePage.addChildNode')}
            className="rounded-md border border-line p-1 text-ink-soft hover:border-accent hover:text-accent"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => onEdit(node)}
            aria-label={t('metricTreePage.edit')}
            className="rounded-md border border-line p-1 text-ink-soft hover:border-accent hover:text-accent"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onRemove(node.id)}
            aria-label={t('metricTreePage.delete')}
            className="rounded-md border border-line p-1 text-ink-faint hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {hasChildren && (
        <ul className="mt-1.5 space-y-1.5">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function NodeModal({
  state,
  sources,
  onClose,
  onSubmit,
}: {
  state: ModalState
  sources: BindableSource[]
  onClose: () => void
  onSubmit: (p: MetricNodeUpdate & { name: string; operator: TreeOperator }) => Promise<void>
}) {
  const { t } = useTranslation()
  const editing = state.mode === 'edit'
  const [name, setName] = useState(editing ? state.name : '')
  const [operator, setOperator] = useState<TreeOperator>(editing ? state.operator : 'add')
  const [value, setValue] = useState(editing && state.value != null ? String(state.value) : '')
  const [kind, setKind] = useState<SourceKind>(editing ? state.binding.source_kind : 'manual')
  const [queryId, setQueryId] = useState(editing ? (state.binding.saved_query_id ?? '') : '')
  const [column, setColumn] = useState(editing ? (state.binding.value_column ?? '') : '')
  const [agg, setAgg] = useState<MetricAgg>(editing ? (state.binding.agg ?? 'sum') : 'sum')
  const [busy, setBusy] = useState(false)

  const field =
    'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none'
  const picked = sources.find((s) => s.saved_query_id === queryId) ?? null
  // /bindable omits queries with no stored run, so a leaf bound to a deleted (or
  // never-re-run) query has a queryId that matches nothing here. Without these
  // fallbacks the select renders blank and Save is disabled forever: the user
  // could not so much as RENAME the node without first discarding its binding.
  const orphaned = kind === 'query' && !!queryId && !picked
  const queryOptions = [
    ...(orphaned ? [{ value: queryId, label: t('metricTreePage.queryUnavailable') }] : []),
    ...sources.map((s) => ({ value: s.saved_query_id, label: s.name })),
  ]
  const columnOptions = picked?.columns ?? (orphaned && column ? [column] : [])
  // A binding is all-or-nothing: the API rejects a half-filled one rather than
  // storing a leaf that silently resolves to `bad_binding`, so the button has to
  // agree with that rule instead of letting the user hit a 422. An orphaned
  // binding is left submittable — the server re-checks ownership, and the leaf
  // is no worse off than it already is.
  const bindingOk =
    kind === 'manual' || (!!queryId && !!column && (!picked || picked.columns.includes(column)))
  const valid = name.trim() !== '' && bindingOk

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onSubmit({
        name: name.trim(),
        operator,
        // Sent even when bound to a query: switching back to manual restores it,
        // and the backend ignores it while source_kind is 'query'.
        manual_value: value === '' ? null : Number(value),
        source_kind: kind,
        ...(kind === 'query'
          ? { saved_query_id: queryId, value_column: column, agg }
          : { saved_query_id: null, value_column: null, agg: null }),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title={
        editing
          ? t('metricTreePage.editNode')
          : state.mode === 'add-root'
            ? t('metricTreePage.rootMetric')
            : t('metricTreePage.childNode')
      }
      subtitle={t('metricTreePage.modalSubtitle')}
    >
      <div className="space-y-4 p-5">
        <Field id="tree-name" label={t('metricTreePage.nameLabel')}>
          <input
            id="tree-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field}
            placeholder={t('metricTreePage.namePlaceholder')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="tree-operator" label={t('metricTreePage.operatorLabel')}>
            <Select
              id="tree-operator"
              value={operator}
              onChange={(e) => setOperator(e.target.value as TreeOperator)}
              options={[
                { value: 'add', label: t('metricTreePage.opAdd') },
                { value: 'sub', label: t('metricTreePage.opSub') },
                { value: 'mul', label: t('metricTreePage.opMul') },
                { value: 'div', label: t('metricTreePage.opDiv') },
              ]}
            />
          </Field>
          <Field id="tree-source-kind" label={t('metricTreePage.sourceLabel')}>
            <Select
              id="tree-source-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SourceKind)}
              options={[
                { value: 'manual', label: t('metricTreePage.sourceManual') },
                // Offered when there is something to bind to; an empty dropdown
                // behind a choice is a dead end, not a feature. Also kept when
                // the leaf ALREADY is query-bound, or the select would have no
                // option matching its own value and render blank.
                ...(sources.length || kind === 'query'
                  ? [{ value: 'query', label: t('metricTreePage.sourceQuery') }]
                  : []),
              ]}
            />
          </Field>
        </div>

        {kind === 'manual' ? (
          <Field id="tree-value" label={t('metricTreePage.valueLabel')} hint={t('metricTreePage.valueHint')}>
            <input
              id="tree-value"
              type="number"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={field}
              placeholder={t('metricTreePage.valuePlaceholder')}
              aria-describedby="tree-value-hint"
            />
          </Field>
        ) : (
          <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3">
            <Field id="tree-query" label={t('metricTreePage.queryLabel')}>
              <Select
                id="tree-query"
                value={queryId}
                onChange={(e) => {
                  setQueryId(e.target.value)
                  // The old column almost never exists in the new query's result,
                  // and keeping it would submit a binding that resolves to
                  // `column_missing` while the form looked complete.
                  setColumn('')
                }}
                options={[
                  { value: '', label: t('metricTreePage.queryPlaceholder') },
                  ...queryOptions,
                ]}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="tree-column" label={t('metricTreePage.columnLabel')}>
                <Select
                  id="tree-column"
                  value={column}
                  disabled={!columnOptions.length}
                  onChange={(e) => setColumn(e.target.value)}
                  options={[
                    { value: '', label: t('metricTreePage.columnPlaceholder') },
                    ...columnOptions.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </Field>
              <Field id="tree-agg" label={t('metricTreePage.aggLabel')}>
                <Select
                  id="tree-agg"
                  value={agg}
                  onChange={(e) => setAgg(e.target.value as MetricAgg)}
                  options={AGGS.map((a) => ({ value: a, label: t(`metricTreePage.agg.${a}`) }))}
                />
              </Field>
            </div>
            <p className="text-xs text-ink-faint">{t('metricTreePage.queryHint')}</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            {t('metricTreePage.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
          >
            {busy ? t('metricTreePage.saving') : t('metricTreePage.save')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
