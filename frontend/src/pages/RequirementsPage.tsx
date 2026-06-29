import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Database, FileText, LayoutDashboard, Sparkles, Upload } from 'lucide-react'
import { useRequirementStore } from '../store/requirementStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { useDashboardStore } from '../store/dashboardStore'

const SAMPLE = `Biznes tələbləri:
- Aylıq gəlir trendi izlənməlidir.
- Ən çox satan 5 məhsul göstərilməlidir.
- Region üzrə satış payı analiz edilməlidir.
- Müştəri sayının aylıq dəyişməsi vacibdir.`

export function RequirementsPage() {
  const navigate = useNavigate()
  const { doc, extracting, building, extract, build, reset } = useRequirementStore()
  const { sources, load: loadSources } = useDatasourceStore()
  const dashStore = useDashboardStore()

  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [datasourceId, setDatasourceId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSources().catch(() => undefined)
  }, [loadSources])

  // Select all KPIs by default whenever a fresh extraction arrives.
  useEffect(() => {
    if (doc) setSelected(new Set(doc.kpis.map((k) => k.question)))
  }, [doc?.id])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setText(await file.text())
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''))
    } catch {
      toast.error('Fayl oxunmadı.')
    }
  }

  const toggle = (q: string) =>
    setSelected((cur) => {
      const next = new Set(cur)
      next.has(q) ? next.delete(q) : next.add(q)
      return next
    })

  const chosen = useMemo(
    () => (doc?.kpis ?? []).filter((k) => selected.has(k.question)).map((k) => k.question),
    [doc, selected],
  )

  const onBuild = async () => {
    const dash = await build(datasourceId, chosen)
    if (dash) {
      await dashStore.loadList()
      await dashStore.open(dash.id)
      navigate('/dashboards')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-6">
        <p className="eyebrow">Tələblər → Dashboard</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Tələbnamə</h1>
        <p className="mt-1 text-sm text-ink-soft">
          BRD və ya user story yapışdır — NexusBI ölçülə bilən KPI-ları çıxarıb dashboard qurur.
        </p>
      </header>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sənəd adı (ixtiyari)"
            className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-ink">
            <Upload size={14} /> Fayl (.txt/.md)
            <input type="file" accept=".txt,.md,.csv,text/*" className="hidden" onChange={onFile} />
          </label>
          <button
            onClick={() => setText(SAMPLE)}
            className="rounded-xl px-3 py-2 text-sm text-ink-faint transition hover:text-ink"
          >
            Nümunə
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Tələb mətnini bura yapışdır…"
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex justify-end gap-2">
          {doc && (
            <button
              onClick={() => {
                reset()
                setText('')
              }}
              className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
            >
              Təmizlə
            </button>
          )}
          <button
            onClick={() => extract(name, text)}
            disabled={extracting || !text.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Sparkles size={15} className={extracting ? 'animate-pulse' : ''} />
            {extracting ? 'Çıxarılır…' : 'KPI çıxar'}
          </button>
        </div>
      </div>

      {doc && doc.kpis.length > 0 && (
        <div className="reveal mt-5 rounded-2xl border border-line bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={16} className="text-accent" />
            <h2 className="font-display text-lg font-semibold text-ink">
              Çıxarılan KPI-lar ({doc.kpis.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {doc.kpis.map((k, i) => {
              const on = selected.has(k.question)
              return (
                <li
                  key={i}
                  onClick={() => toggle(k.question)}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    on ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface-2'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      readOnly
                      className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{k.name}</p>
                      <p className="text-sm text-ink-soft">{k.question}</p>
                      {k.requirement_ref && (
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                          ↳ {k.requirement_ref}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
              <Database size={14} className="text-accent" />
              <select
                value={datasourceId ?? ''}
                onChange={(e) => setDatasourceId(e.target.value || null)}
                className="bg-transparent text-ink focus:outline-none"
              >
                <option value="">Demo data</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={onBuild}
              disabled={building || chosen.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
            >
              <LayoutDashboard size={15} />
              {building ? 'Qurulur…' : `Dashboard qur (${chosen.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
