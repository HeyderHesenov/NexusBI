import { useEffect, useState } from 'react'
import { GitBranch, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMetricTreeStore } from '../store/metricTreeStore'
import { ModalShell } from '../components/ui/ModalShell'
import type { EvaluatedNode, TreeOperator } from '../types'

const OP_SYMBOL: Record<string, string> = { add: '+', sub: '−', mul: '×', div: '÷' }

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString('az-AZ', { maximumFractionDigits: 1 }) : String(Math.round(n * 100) / 100)

type ModalState =
  | { mode: 'add-root' }
  | { mode: 'add-child'; parentId: string }
  | { mode: 'edit'; nodeId: string; name: string; operator: TreeOperator; value: number | null }

export function MetricTreePage() {
  const { forest, load, add, edit, remove } = useMetricTreeStore()
  const [modal, setModal] = useState<ModalState | null>(null)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Analiz</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Metrik ağacı</h1>
          <p className="mt-1 text-sm text-ink-soft">KPI-nı parçala (məs. Gəlir = Qiymət × Həcm) — dəyərlər aşağıdan-yuxarı toplanır.</p>
        </div>
        <button
          onClick={() => setModal({ mode: 'add-root' })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> Kök metrik
        </button>
      </header>

      {forest.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <GitBranch size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">Ağac boşdur</p>
            <p className="mt-1 text-sm text-ink-soft">Bir kök metrik yarat, sonra alt-driver-lər əlavə et.</p>
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
                setModal({ mode: 'edit', nodeId: node.id, name: node.name, operator: node.operator as TreeOperator, value: node.manual_value })
              }
              onRemove={remove}
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
            else await add({ ...payload, parent_id: modal.mode === 'add-child' ? modal.parentId : null })
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
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.abs(node.contribution_pct))}%` }} />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => onAddChild(node.id)} aria-label="Alt-düyün" title="Alt-düyün əlavə et" className="rounded-md border border-line p-1 text-ink-soft hover:border-accent hover:text-accent">
            <Plus size={13} />
          </button>
          <button onClick={() => onEdit(node)} aria-label="Redaktə" className="rounded-md border border-line p-1 text-ink-soft hover:border-accent hover:text-accent">
            <Pencil size={13} />
          </button>
          <button onClick={() => onRemove(node.id)} aria-label="Sil" className="rounded-md border border-line p-1 text-ink-faint hover:border-[#D87C6B]/50 hover:text-[#D87C6B]">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {hasChildren && (
        <ul className="mt-1.5 space-y-1.5">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} onAddChild={onAddChild} onEdit={onEdit} onRemove={onRemove} />
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
  onSubmit: (p: { name: string; operator: TreeOperator; manual_value: number | null }) => Promise<void>
}) {
  const editing = state.mode === 'edit'
  const [name, setName] = useState(editing ? state.name : '')
  const [operator, setOperator] = useState<TreeOperator>(editing ? state.operator : 'add')
  const [value, setValue] = useState(editing && state.value != null ? String(state.value) : '')
  const [busy, setBusy] = useState(false)

  const field = 'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none'
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
      title={editing ? 'Düyünü redaktə et' : state.mode === 'add-root' ? 'Kök metrik' : 'Alt-düyün'}
      subtitle="Yarpaq üçün dəyər, valideyn üçün operator"
    >
      <div className="space-y-4">
        <div>
          <p className="eyebrow mb-1">Ad</p>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="məs. Qiymət" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="eyebrow mb-1">Operator (alt-düyünlər üçün)</p>
            <select value={operator} onChange={(e) => setOperator(e.target.value as TreeOperator)} className={field}>
              <option value="add">+ Cəm</option>
              <option value="sub">− Fərq</option>
              <option value="mul">× Hasil</option>
              <option value="div">÷ Bölmə</option>
            </select>
          </div>
          <div>
            <p className="eyebrow mb-1">Dəyər (yarpaq)</p>
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)} className={field} placeholder="boş = hesablanır" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink">Ləğv et</button>
          <button onClick={submit} disabled={!valid || busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50">
            {busy ? 'Saxlanır…' : 'Saxla'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
