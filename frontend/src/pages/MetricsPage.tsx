import { useEffect, useState } from 'react'
import { BadgeCheck, Plus, ShieldCheck, Tag, Trash2 } from 'lucide-react'
import { useMetricStore } from '../store/metricStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { ModalShell } from '../components/ui/ModalShell'
import type { MetricCreate } from '../types'

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function MetricsPage() {
  const { items, load, add, setVerified, remove } = useMetricStore()
  const { sources, load: loadSources } = useDatasourceStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load().catch(() => undefined)
    loadSources().catch(() => undefined)
  }, [load, loadSources])

  const sourceName = (id: string | null) =>
    id ? sources.find((s) => s.id === id)?.name ?? 'Mənbə' : 'Demo / qlobal'

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Semantik qat</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Metriklər</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Biznes metriklərini bir dəfə təyin et — AI sorğularda onları tutarlı işlədir.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> Metrik əlavə et
        </button>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <Tag size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">Hələ metrik yoxdur</p>
          <p className="mt-1 text-sm text-ink-soft">
            Məsələn: “Gəlir = SUM(revenue)”, sinonimlər: satış, dövriyyə.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((m) => (
            <li key={m.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{m.name}</span>
                    {m.verified && (
                      <span
                        title={`Təsdiqləyən: ${m.verified_by ?? '—'}`}
                        className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent"
                      >
                        <BadgeCheck size={11} /> Təsdiqli
                      </span>
                    )}
                    {m.expression && (
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                        {m.expression}
                      </code>
                    )}
                  </div>
                  {m.synonyms && (
                    <p className="mt-1 text-xs text-ink-faint">sinonimlər: {m.synonyms}</p>
                  )}
                  {m.description && <p className="mt-1 text-sm text-ink-soft">{m.description}</p>}
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {sourceName(m.datasource_id)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setVerified(m.id, !m.verified)}
                    title={m.verified ? 'Təsdiqi geri al' : 'Təsdiqlə'}
                    className={`rounded-lg border p-1.5 transition ${
                      m.verified
                        ? 'border-accent text-accent'
                        : 'border-line text-ink-soft hover:border-accent hover:text-accent'
                    }`}
                  >
                    <ShieldCheck size={15} />
                  </button>
                  <button
                    onClick={() => remove(m.id)}
                    title="Sil"
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddMetricModal open={open} onClose={() => setOpen(false)} onAdd={add} />
    </div>
  )
}

function AddMetricModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (m: MetricCreate) => Promise<void>
}) {
  const { sources } = useDatasourceStore()
  const [name, setName] = useState('')
  const [expression, setExpression] = useState('')
  const [synonyms, setSynonyms] = useState('')
  const [description, setDescription] = useState('')
  const [datasourceId, setDatasourceId] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onAdd({
        name: name.trim(),
        expression: expression.trim(),
        synonyms: synonyms.trim(),
        description: description.trim(),
        datasource_id: datasourceId || null,
      })
      setName('')
      setExpression('')
      setSynonyms('')
      setDescription('')
      setDatasourceId('')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Metrik əlavə et"
      subtitle="Ad + ifadə (məs. SUM(revenue)) + sinonimlər."
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            Ləğv et
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            Saxla
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad (məs. Gəlir)" className={field} />
        <input value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="İfadə (məs. SUM(revenue))" className={`${field} font-mono text-sm`} />
        <input value={synonyms} onChange={(e) => setSynonyms(e.target.value)} placeholder="Sinonimlər (vergüllə: satış, dövriyyə)" className={field} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Təsvir (opsional)" className={field} />
        <select value={datasourceId} onChange={(e) => setDatasourceId(e.target.value)} className={field}>
          <option value="">Demo / qlobal</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    </ModalShell>
  )
}
