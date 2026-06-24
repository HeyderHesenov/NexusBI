import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { ChartRenderer } from '../components/charts/ChartRenderer'
import { NLQueryInput } from '../components/query/NLQueryInput'
import { QueryHistory } from '../components/query/QueryHistory'
import { SQLPreview } from '../components/query/SQLPreview'
import { useQueryStore } from '../store/queryStore'

const DEMO = import.meta.env.VITE_DEMO_MODE !== 'false'

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
    <div className="flex gap-6">
      <div className="w-64 shrink-0">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Tarixçə</h2>
        <QueryHistory items={history} onSelect={(i) => onAsk(i.natural_language)} />
      </div>

      <div className="flex flex-1 flex-col gap-4">
        {DEMO && (
          <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
            Demo mode — real DB bağlı deyil.
          </div>
        )}
        <NLQueryInput onSubmit={onAsk} loading={loading} />

        {loading && <LoadingSkeleton />}

        {result && !loading && (
          <div className="flex flex-col gap-4">
            <SQLPreview sql={result.sql} />
            {result.insight && (
              <div className="rounded-lg border border-teal-700/50 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
                {result.insight}
              </div>
            )}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <ChartRenderer data={result.data} config={result.chart_config} />
            </div>
            <button
              onClick={() => toast.success('Dashboard funksiyası tezliklə.')}
              className="self-start rounded-lg border border-brand px-4 py-2 text-sm text-brand"
            >
              Dashboard-a saxla
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-8 w-1/3 animate-pulse rounded bg-slate-800" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-800" />
    </div>
  )
}
