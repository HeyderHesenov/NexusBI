import { AlertTriangle, Bookmark, Clock, Database, Lightbulb, LayoutGrid, Maximize2, MessageSquarePlus, RefreshCw, Target, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ChartView } from '../components/charts/ChartView'
import { HistoryDeleteUI } from '../components/query/HistoryDeleteUI'
import { useHistoryDelete } from '../hooks/useHistoryDelete'
import { TypewriterText } from '../components/charts/TypewriterText'
import { SaveToDashboardModal } from '../components/dashboard/SaveToDashboardModal'
import { CreateDecisionModal } from '../components/query/CreateDecisionModal'
import { DatasourcePicker } from '../components/query/DatasourcePicker'
import { NLQueryInput } from '../components/query/NLQueryInput'
import { SaveQueryModal } from '../components/query/SaveQueryModal'
import { SchemaBrowser } from '../components/query/SchemaBrowser'
import { SQLPreview } from '../components/query/SQLPreview'
import { useQueryStore, type ChatTurn } from '../store/queryStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { buildSamples } from '../lib/sampleQueries'

export function QueryPage() {
  const { thread, loading, error, ask, retry, newChat, history, loadHistory, datasourceId } =
    useQueryStore()
  const { schemas, loadSchema } = useDatasourceStore()
  const del = useHistoryDelete()
  const [saveLogId, setSaveLogId] = useState<string | null>(null)
  const [saveQ, setSaveQ] = useState<string | null>(null)
  const [decideFor, setDecideFor] = useState<{ insight: string; logId: string | null } | null>(null)

  useEffect(() => {
    loadHistory().catch(() => undefined)
  }, [loadHistory])

  useEffect(() => {
    if (datasourceId) loadSchema(datasourceId).catch(() => undefined)
  }, [datasourceId, loadSchema])

  const samples = useMemo(
    () => (datasourceId && schemas[datasourceId] ? buildSamples(schemas[datasourceId]) : undefined),
    [datasourceId, schemas],
  )

  const onAsk = (q: string) => {
    ask(q).catch(() => undefined)
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_240px]">
        <div className="min-w-0 space-y-6">
          <header>
            <p className="eyebrow">Sorğu konsolu</p>
            <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink">
              Datanla danış,
              <br />
              cavabı plotda gör.
            </h1>
          </header>

          <div className="flex items-center justify-between gap-2">
            <DatasourcePicker />
            {thread.length > 0 && (
              <button
                onClick={newChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-ink"
              >
                <MessageSquarePlus size={14} /> Yeni söhbət
              </button>
            )}
          </div>

          <NLQueryInput onSubmit={onAsk} loading={loading} samples={samples} />
          {thread.length > 0 && (
            <p className="text-xs text-ink-faint">
              İpucu: davam sualı ver — “bunu aya görə böl”, “yalnız 2024”.
            </p>
          )}

          {loading && <LoadingState />}

          {error && !loading && (
            <div className="space-y-2 rounded-2xl border border-[#D87C6B]/40 bg-[#D87C6B]/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[#D87C6B]" />
                <p className="text-sm font-medium text-ink">{error.message}</p>
              </div>
              {error.detail && <p className="text-xs text-ink-soft">{error.detail}</p>}
              {error.sql && (
                <pre className="overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] text-ink-soft">
                  {error.sql}
                </pre>
              )}
              <button
                onClick={() => retry().catch(() => undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-ink"
              >
                <RefreshCw size={13} /> Yenidən cəhd et
              </button>
            </div>
          )}

          {/* Conversation — newest turn first */}
          {[...thread].reverse().map((turn, i) => (
            <TurnCard
              key={thread.length - 1 - i}
              turn={turn}
              onSaveDashboard={() => turn.result.query_log_id && setSaveLogId(turn.result.query_log_id)}
              onSaveQuery={() => setSaveQ(turn.q)}
              onMakeDecision={() =>
                setDecideFor({ insight: turn.result.insight || turn.q, logId: turn.result.query_log_id })
              }
            />
          ))}

          {thread.length === 0 && !loading && !error && <EmptyState />}
        </div>

        <aside className="space-y-6 lg:border-l lg:border-line lg:pl-6">
          {datasourceId && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Database size={14} className="text-ink-faint" />
                <span className="eyebrow">Cədvəllər</span>
              </div>
              <SchemaBrowser datasourceId={datasourceId} />
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Clock size={14} className="text-ink-faint" />
              <span className="eyebrow">Son sorğular</span>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-ink-faint">Hələ sorğu yoxdur.</p>
            ) : (
              <ul className="space-y-1">
                {history.slice(0, 12).map((item) => (
                  <li key={item.id} className="group relative">
                    <button
                      onClick={() => onAsk(item.natural_language)}
                      onContextMenu={(e) => del.openMenu(item.id, e)}
                      title={item.natural_language}
                      className="w-full truncate rounded-lg px-2 py-1.5 pr-8 text-left text-sm text-ink-soft transition hover:bg-surface hover:text-ink"
                    >
                      {item.natural_language}
                    </button>
                    <button
                      onClick={() => del.askDelete(item.id)}
                      aria-label="Sorğunu sil"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-surface-2 hover:text-[#D87C6B] focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {saveLogId && (
        <SaveToDashboardModal
          open={!!saveLogId}
          queryLogId={saveLogId}
          title=""
          onClose={() => setSaveLogId(null)}
        />
      )}

      {saveQ && (
        <SaveQueryModal
          open={!!saveQ}
          onClose={() => setSaveQ(null)}
          nlQuery={saveQ}
          datasourceId={datasourceId}
        />
      )}

      {decideFor && (
        <CreateDecisionModal
          open={!!decideFor}
          onClose={() => setDecideFor(null)}
          insight={decideFor.insight}
          queryLogId={decideFor.logId}
        />
      )}

      <HistoryDeleteUI del={del} />
    </>
  )
}

function TurnCard({
  turn,
  onSaveDashboard,
  onSaveQuery,
  onMakeDecision,
}: {
  turn: ChatTurn
  onSaveDashboard: () => void
  onSaveQuery: () => void
  onMakeDecision: () => void
}) {
  const { result, q } = turn
  const [fs, setFs] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs text-accent">
          ?
        </span>
        <p className="pt-0.5 text-sm font-medium text-ink">{q}</p>
      </div>

      {result.insight && (
        <div className="flex gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-4">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="eyebrow mb-1 text-accent">İnsight</p>
            <TypewriterText
              key={result.query_log_id ?? result.insight}
              text={result.insight}
              className="text-sm leading-relaxed text-ink"
            />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-end gap-2">
          {result.from_cache && (
            <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              keşdən
            </span>
          )}
          <span className="font-mono text-[11px] text-ink-faint">
            {result.data.length} sətir · {result.execution_time_ms} ms
          </span>
          <button
            onClick={() => setFs(true)}
            aria-label="Tam ekran"
            title="Tam ekran"
            className="rounded-md p-1 text-ink-faint transition hover:bg-surface-2 hover:text-accent"
          >
            <Maximize2 size={15} />
          </button>
        </div>
        <ChartView
          data={result.data}
          config={result.chart_config}
          exportName="nexusbi-query"
          queryLogId={result.query_log_id}
          title={q}
          fullscreen={fs}
          onFullscreenChange={setFs}
        />
      </div>

      <SQLPreview sql={result.sql} language={result.query_language} />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSaveDashboard}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <LayoutGrid size={15} /> Dashboard-a saxla
        </button>
        <button
          onClick={onSaveQuery}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Bookmark size={15} /> Sorğunu saxla
        </button>
        <button
          onClick={onMakeDecision}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Target size={15} /> Qərara çevir
        </button>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
        Data plota çevrilir…
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-line bg-surface" />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="plot-grid grid min-h-[50vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-lg text-ink">Nəticə burada plot olunacaq</p>
      <p className="mt-1 text-sm text-ink-soft">
        Yuxarıdakı nümunələrdən birinə toxun və ya öz sualını yaz.
      </p>
    </div>
  )
}
