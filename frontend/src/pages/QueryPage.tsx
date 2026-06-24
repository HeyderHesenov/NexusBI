import { Lightbulb, Sparkles, Clock } from 'lucide-react'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { ChartRenderer } from '../components/charts/ChartRenderer'
import { NLQueryInput } from '../components/query/NLQueryInput'
import { SQLPreview } from '../components/query/SQLPreview'
import { useQueryStore } from '../store/queryStore'

export function QueryPage() {
  const { result, loading, ask, history, loadHistory } = useQueryStore()

  useEffect(() => {
    loadHistory().catch(() => undefined)
  }, [loadHistory])

  const onAsk = async (q: string) => {
    try {
      await ask(q)
    } catch {
      /* interceptor toast */
    }
  }

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_240px]">
      <div className="min-w-0 space-y-6">
        <header>
          <p className="eyebrow">Sorğu konsolu</p>
          <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink">
            Sual ver,
            <br />
            cavabı plotda gör.
          </h1>
        </header>

        <NLQueryInput onSubmit={onAsk} loading={loading} />

        {loading && <LoadingState />}

        {result && !loading && (
          <div className="space-y-4">
            {result.insight && (
              <div className="flex gap-3 rounded-2xl border border-signal/40 bg-signal/10 px-5 py-4">
                <Lightbulb size={18} className="mt-0.5 shrink-0 text-signal-press" />
                <div>
                  <p className="eyebrow mb-1 text-signal-press">İnsight</p>
                  <p className="text-sm leading-relaxed text-ink">{result.insight}</p>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-grid bg-panel p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-brand" />
                  <span className="font-mono text-xs uppercase tracking-wider text-muted">
                    {result.chart_config.chart_type}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted">
                  {result.data.length} sətir · {result.execution_time_ms} ms
                </span>
              </div>
              <ChartRenderer data={result.data} config={result.chart_config} />
            </div>

            <SQLPreview sql={result.sql} />

            <button
              onClick={() => toast.success('Dashboard funksiyası tezliklə.')}
              className="rounded-xl border border-brand px-4 py-2 text-sm font-medium text-brand transition hover:bg-brand hover:text-white"
            >
              Dashboard-a saxla
            </button>
          </div>
        )}

        {!result && !loading && <EmptyState />}
      </div>

      <aside className="lg:border-l lg:border-grid lg:pl-6">
        <div className="mb-3 flex items-center gap-2">
          <Clock size={14} className="text-muted" />
          <span className="eyebrow">Son sorğular</span>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Hələ sorğu yoxdur.</p>
        ) : (
          <ul className="space-y-1">
            {history.slice(0, 12).map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => onAsk(item.natural_language)}
                  title={item.natural_language}
                  className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-muted transition hover:bg-panel hover:text-ink"
                >
                  {item.natural_language}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 animate-ping rounded-full bg-signal" />
        Data plota çevrilir…
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-grid bg-panel" />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="plot-grid rounded-2xl border border-dashed border-grid px-6 py-16 text-center">
      <p className="font-display text-lg text-ink">Nəticə burada plot olunacaq</p>
      <p className="mt-1 text-sm text-muted">
        Yuxarıdakı nümunələrdən birinə toxun və ya öz sualını yaz.
      </p>
    </div>
  )
}
