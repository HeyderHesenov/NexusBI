import { useEffect, useState } from 'react'
import { CheckCircle2, Plus, Play, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import { useDataContractStore } from '../store/dataContractStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { ModalShell } from '../components/ui/ModalShell'
import type { ContractRule, DataContract, Expectation } from '../types'

const RULES: { value: ContractRule; label: string; needsColumn: boolean; needsRange: boolean }[] = [
  { value: 'not_null', label: 'Boş deyil', needsColumn: true, needsRange: false },
  { value: 'unique', label: 'Unikal', needsColumn: true, needsRange: false },
  { value: 'range', label: 'Diapazon', needsColumn: true, needsRange: true },
  { value: 'freshness', label: 'Təzəlik (SLA)', needsColumn: false, needsRange: false },
  { value: 'schema', label: 'Sxem sabitliyi', needsColumn: false, needsRange: false },
]

const field = 'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none'

const STATUS: Record<string, { cls: string; label: string }> = {
  pass: { cls: 'bg-accent-soft text-accent', label: 'Keçdi' },
  fail: { cls: 'bg-[#D87C6B]/15 text-[#D87C6B]', label: 'Pozuldu' },
  unknown: { cls: 'bg-surface-2 text-ink-faint', label: 'Yoxlanmayıb' },
}

export function DataContractsPage() {
  const { items, runsById, load, add, run, loadRuns, remove } = useDataContractStore()
  const { sources, load: loadSources } = useDatasourceStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load().catch(() => undefined)
    loadSources().catch(() => undefined)
  }, [load, loadSources])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Məlumat</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Data müqavilələri</h1>
          <p className="mt-1 text-sm text-ink-soft">Mənbə cədvəllərinə keyfiyyət zəmanəti — boşluq, unikallıq, diapazon, sxem, təzəlik.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          disabled={sources.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
        >
          <Plus size={15} /> Yeni müqavilə
        </button>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <ShieldCheck size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">Müqavilə yoxdur</p>
            <p className="mt-1 text-sm text-ink-soft">
              {sources.length === 0 ? 'Əvvəlcə bir mənbə əlavə et (Mənbələr).' : 'Cədvələ keyfiyyət qaydaları təyin et.'}
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <ContractCard
              key={c.id}
              contract={c}
              dsName={sources.find((s) => s.id === c.datasource_id)?.name ?? c.datasource_id}
              runs={runsById[c.id]}
              onRun={() => run(c.id)}
              onToggleRuns={() => loadRuns(c.id)}
              onRemove={() => remove(c.id)}
            />
          ))}
        </ul>
      )}

      {open && (
        <CreateModal
          sources={sources.filter((s) => s.db_type !== 'powerbi')}
          onClose={() => setOpen(false)}
          onCreate={async (p) => {
            await add(p)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

function ContractCard({
  contract,
  dsName,
  runs,
  onRun,
  onToggleRuns,
  onRemove,
}: {
  contract: DataContract
  dsName: string
  runs: ContractRunList
  onRun: () => Promise<void>
  onToggleRuns: () => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const st = STATUS[contract.last_status] ?? STATUS.unknown
  const latest = runs?.[0]

  const doRun = async () => {
    setBusy(true)
    try {
      await onRun()
      setShowResults(true)
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">{contract.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            {dsName} · {contract.table_name} · {contract.expectations.length} qayda
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
          <button onClick={doRun} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-60">
            <Play size={13} /> {busy ? 'Yoxlanır…' : 'Yoxla'}
          </button>
          <button onClick={onRemove} aria-label="Sil" className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {latest && (showResults || contract.last_status !== 'unknown') && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {latest.results.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {r.passed ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <XCircle size={15} className="mt-0.5 shrink-0 text-[#D87C6B]" />
              )}
              <span className="min-w-0 text-ink-soft">
                <span className="font-medium text-ink">{r.column ? `${r.column} · ` : ''}{r.rule}</span> — {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
      {contract.last_status !== 'unknown' && !runs && (
        <button onClick={onToggleRuns} className="mt-2 text-xs text-accent hover:underline">Nəticələri göstər</button>
      )}
    </li>
  )
}

type ContractRunList = import('../types').ContractRun[] | undefined

function CreateModal({
  sources,
  onClose,
  onCreate,
}: {
  sources: import('../types').DataSource[]
  onClose: () => void
  onCreate: (p: import('../types').DataContractCreate) => Promise<void>
}) {
  const [datasourceId, setDatasourceId] = useState(sources[0]?.id ?? '')
  const [table, setTable] = useState('')
  const [name, setName] = useState('')
  const [exps, setExps] = useState<Expectation[]>([{ rule: 'not_null', column: '' }])
  const [busy, setBusy] = useState(false)

  const valid = datasourceId && table.trim() && name.trim() && exps.length > 0

  const setExp = (i: number, patch: Partial<Expectation>) =>
    setExps((cur) => cur.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const cleaned: Expectation[] = exps.map((e) => {
        const meta = RULES.find((r) => r.value === e.rule)!
        const out: Expectation = { rule: e.rule }
        if (meta.needsColumn) out.column = (e.column ?? '').trim()
        if (meta.needsRange) out.params = { min: Number(e.params?.min ?? 0), max: Number(e.params?.max ?? 0) }
        return out
      })
      await onCreate({ datasource_id: datasourceId, table_name: table.trim(), name: name.trim(), expectations: cleaned })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} title="Yeni data müqaviləsi" subtitle="Cədvələ keyfiyyət qaydaları">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="eyebrow mb-1">Mənbə</p>
            <select value={datasourceId} onChange={(e) => setDatasourceId(e.target.value)} className={field}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="eyebrow mb-1">Cədvəl</p>
            <input value={table} onChange={(e) => setTable(e.target.value)} className={field} placeholder="cədvəl adı" />
          </div>
        </div>
        <div>
          <p className="eyebrow mb-1">Ad</p>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="məs. Satış keyfiyyəti" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Qaydalar</p>
            <button onClick={() => setExps((c) => [...c, { rule: 'not_null', column: '' }])} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus size={12} /> Qayda
            </button>
          </div>
          {exps.map((e, i) => {
            const meta = RULES.find((r) => r.value === e.rule)!
            return (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2">
                <select value={e.rule} onChange={(ev) => setExp(i, { rule: ev.target.value as ContractRule })} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none">
                  {RULES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {meta.needsColumn && (
                  <input value={e.column ?? ''} onChange={(ev) => setExp(i, { column: ev.target.value })} placeholder="sütun" className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none" />
                )}
                {meta.needsRange && (
                  <>
                    <input type="number" value={e.params?.min ?? ''} onChange={(ev) => setExp(i, { params: { ...e.params, min: Number(ev.target.value) } as Record<string, number> })} placeholder="min" className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none" />
                    <input type="number" value={e.params?.max ?? ''} onChange={(ev) => setExp(i, { params: { ...e.params, max: Number(ev.target.value) } as Record<string, number> })} placeholder="max" className="w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none" />
                  </>
                )}
                <button onClick={() => setExps((c) => c.filter((_, idx) => idx !== i))} aria-label="Sil" className="ml-auto rounded-md p-1 text-ink-faint hover:text-[#D87C6B]">
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink">Ləğv et</button>
          <button onClick={submit} disabled={!valid || busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50">
            {busy ? 'Yaradılır…' : 'Yarat'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
