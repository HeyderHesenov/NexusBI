import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMetricTreeStore } from '../../store/metricTreeStore'
import { ModalShell } from '../ui/ModalShell'
import { Field, Select } from '../ui/form'
import { formatMetricValue as fmt } from '../../lib/format'
import type { EvaluatedNode, TreeOperator } from '../../types'

const OP_SYMBOL: Record<string, string> = { add: '+', sub: '−', mul: '×', div: '÷' }

type ModalState =
  | { mode: 'add-root' }
  | { mode: 'add-child'; parentId: string }
  | { mode: 'edit'; nodeId: string; name: string; operator: TreeOperator; value: number | null }

/** Metric-tree builder — add/edit/remove KPI decomposition nodes. Lives inside the
 *  Digital Twin ("Ağac" tab); `onChange` lets the twin re-evaluate after any edit
 *  so the simulator reflects the new tree. */
export function MetricTreeEditor({ onChange }: { onChange?: () => void }) {
  const { t } = useTranslation()
  const { forest, load, add, edit, remove } = useMetricTreeStore()
  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

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
            <span className="font-display text-sm font-bold text-ink">{fmt(node.value)}</span>
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
  onClose,
  onSubmit,
}: {
  state: ModalState
  onClose: () => void
  onSubmit: (p: {
    name: string
    operator: TreeOperator
    manual_value: number | null
  }) => Promise<void>
}) {
  const { t } = useTranslation()
  const editing = state.mode === 'edit'
  const [name, setName] = useState(editing ? state.name : '')
  const [operator, setOperator] = useState<TreeOperator>(editing ? state.operator : 'add')
  const [value, setValue] = useState(editing && state.value != null ? String(state.value) : '')
  const [busy, setBusy] = useState(false)

  const field =
    'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none'
  const valid = name.trim() !== ''

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await onSubmit({
        name: name.trim(),
        operator,
        manual_value: value === '' ? null : Number(value),
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
          <Field id="tree-value" label={t('metricTreePage.valueLabel')}>
            <input
              id="tree-value"
              type="number"
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={field}
              placeholder={t('metricTreePage.valuePlaceholder')}
            />
          </Field>
        </div>
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
