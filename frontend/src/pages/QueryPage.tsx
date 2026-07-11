import { AlertTriangle, Bookmark, Clock, Code2, Database, Lightbulb, LayoutGrid, Maximize2, MessageSquarePlus, Pencil, RefreshCw, Sparkles, Target, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChartView } from '../components/charts/ChartView'
import { HistoryDeleteUI } from '../components/query/HistoryDeleteUI'
import { useHistoryDelete } from '../hooks/useHistoryDelete'
import { TypewriterText } from '../components/charts/TypewriterText'
import { StatFactChips } from '../components/charts/StatFactChips'
import { TrustBadge } from '../components/query/TrustBadge'
import { SaveToDashboardModal } from '../components/dashboard/SaveToDashboardModal'
import { CreateDecisionModal } from '../components/query/CreateDecisionModal'
import { DatasourcePicker } from '../components/query/DatasourcePicker'
import { OnboardingChecklist } from '../components/onboarding/OnboardingChecklist'
import { NLQueryInput } from '../components/query/NLQueryInput'
import { SaveQueryModal } from '../components/query/SaveQueryModal'
import { SchemaBrowser } from '../components/query/SchemaBrowser'
import { SQLEditor } from '../components/query/SQLEditor'
import { SQLPreview } from '../components/query/SQLPreview'
import { useQueryStore, type ChatTurn, type QueryError } from '../store/queryStore'
import { useDatasourceStore } from '../store/datasourceStore'
import { buildSamples } from '../lib/sampleQueries'
import { isSqlLabel, stripSqlLabel } from '../lib/sqlLabel'
import type { DataSourceSchema } from '../types'

export function QueryPage() {
  const { t } = useTranslation()
  const { thread, loading, error, ask, runSql, retry, newChat, history, loadHistory, datasourceId } =
    useQueryStore()
  const { schemas, loadSchema } = useDatasourceStore()
  const del = useHistoryDelete()
  const [saveLogId, setSaveLogId] = useState<string | null>(null)
  const [saveQ, setSaveQ] = useState<string | null>(null)
  const [decideFor, setDecideFor] = useState<{ insight: string; logId: string | null; question: string } | null>(null)
  const [mode, setMode] = useState<'nl' | 'sql'>('nl')
  const schema = datasourceId ? schemas[datasourceId] : undefined

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
            <p className="eyebrow">{t('queryPage.eyebrow')}</p>
            <h1 className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink">
              {t('queryPage.headingLine1')}
              <br />
              {t('queryPage.headingLine2')}
            </h1>
          </header>

          <OnboardingChecklist />

          <div className="flex items-center justify-between gap-2">
            <DatasourcePicker />
            <div className="flex items-center gap-2">
              <ModeToggle mode={mode} onChange={setMode} />
              {thread.length > 0 && (
                <button
                  onClick={newChat}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-ink"
                >
                  <MessageSquarePlus size={14} /> {t('queryPage.newChat')}
                </button>
              )}
            </div>
          </div>

          {mode === 'nl' ? (
            <NLQueryInput onSubmit={onAsk} loading={loading} samples={samples} />
          ) : (
            <SqlEditorCard
              // Remount when the source (and therefore the autocomplete schema)
              // changes so table/column completion reflects the active datasource.
              editorKey={`sql-${datasourceId ?? 'demo'}-${schema ? 'ready' : 'pending'}`}
              schema={schema}
              onRun={(sql) => runSql(sql)}
              runLabel={t('queryPage.runQuery')}
              subtitle={t('queryPage.sqlSubtitle')}
            />
          )}
          {mode === 'nl' && thread.length > 0 && (
            <p className="text-xs text-ink-faint">
              {t('queryPage.followUpHint')}
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
                <RefreshCw size={13} /> {t('queryPage.retry')}
              </button>
            </div>
          )}

          {/* Conversation — newest turn first */}
          {[...thread].reverse().map((turn, i) => (
            <TurnCard
              key={thread.length - 1 - i}
              turn={turn}
              schema={schema}
              onRunSql={(sql) => runSql(sql)}
              onSaveDashboard={() => turn.result.query_log_id && setSaveLogId(turn.result.query_log_id)}
              onSaveQuery={() => setSaveQ(turn.q)}
              onMakeDecision={() =>
                setDecideFor({
                  insight: turn.result.insight || turn.q,
                  logId: turn.result.query_log_id,
                  question: turn.q,
                })
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
                <span className="eyebrow">{t('queryPage.tables')}</span>
              </div>
              <SchemaBrowser datasourceId={datasourceId} />
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center gap-2">
              <Clock size={14} className="text-ink-faint" />
              <span className="eyebrow">{t('queryPage.recentQueries')}</span>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-ink-faint">{t('queryPage.noQueriesYet')}</p>
            ) : (
              <ul className="space-y-1">
                {history.slice(0, 12).map((item) => (
                  <li key={item.id} className="group relative">
                    <button
                      onClick={() => !isSqlLabel(item.natural_language) && onAsk(item.natural_language)}
                      onContextMenu={(e) => del.openMenu(item.id, e)}
                      title={item.natural_language}
                      className="flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1.5 pr-8 text-left text-sm text-ink-soft transition hover:bg-surface hover:text-ink"
                    >
                      {isSqlLabel(item.natural_language) && (
                        <span className="shrink-0 rounded border border-line px-1 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                          sql
                        </span>
                      )}
                      <span className="truncate">{stripSqlLabel(item.natural_language)}</span>
                    </button>
                    <button
                      onClick={() => del.askDelete(item.id)}
                      aria-label={t('queryPage.deleteQuery')}
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
          question={decideFor.question}
          datasourceId={datasourceId}
        />
      )}

      <HistoryDeleteUI del={del} />
    </>
  )
}

function TurnCard({
  turn,
  schema,
  onRunSql,
  onSaveDashboard,
  onSaveQuery,
  onMakeDecision,
}: {
  turn: ChatTurn
  schema?: DataSourceSchema
  onRunSql: (sql: string) => Promise<QueryError | null>
  onSaveDashboard: () => void
  onSaveQuery: () => void
  onMakeDecision: () => void
}) {
  const { t } = useTranslation()
  const { result, q } = turn
  const [fs, setFs] = useState(false)
  const [editing, setEditing] = useState(false)
  // Editing raw SQL only makes sense for SQL sources (Power BI results are DAX).
  const canEdit = (result.query_language ?? 'sql') === 'sql'
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs text-accent">
          ?
        </span>
        <p className="pt-0.5 text-sm font-medium text-ink">{q}</p>
      </div>

      {(result.insight || (result.stats_facts?.length ?? 0) > 0) && (
        <div className="flex gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-4">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="eyebrow mb-1 text-accent">{t('queryPage.insight')}</p>
            {result.insight && (
              <TypewriterText
                key={result.query_log_id ?? result.insight}
                text={result.insight}
                className="text-sm leading-relaxed text-ink"
              />
            )}
            <StatFactChips facts={result.stats_facts ?? []} />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-end gap-2">
          <TrustBadge provenance={result.provenance} confidence={result.confidence} />
          {result.from_cache && (
            <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
              {t('queryPage.fromCache')}
            </span>
          )}
          <span className="font-mono text-[11px] text-ink-faint">
            {t('queryPage.rowsMs', { n: result.data.length, ms: result.execution_time_ms })}
          </span>
          <button
            onClick={() => setFs(true)}
            aria-label={t('queryPage.fullscreen')}
            title={t('queryPage.fullscreen')}
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

      {canEdit && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft transition hover:text-accent"
        >
          <Pencil size={13} /> {t('queryPage.editSql')}
        </button>
      )}
      {canEdit && editing && (
        <SqlEditorCard
          editorKey={`edit-${result.query_log_id ?? q}`}
          initialValue={result.sql}
          schema={schema}
          emphasized
          onRun={async (sql) => {
            const err = await onRunSql(sql)
            if (!err) setEditing(false)
            return err
          }}
          onCancel={() => setEditing(false)}
          runLabel={t('queryPage.runEditedSql')}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSaveDashboard}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <LayoutGrid size={15} /> {t('queryPage.saveToDashboard')}
        </button>
        <button
          onClick={onSaveQuery}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Bookmark size={15} /> {t('queryPage.saveQuery')}
        </button>
        <button
          onClick={onMakeDecision}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <Target size={15} /> {t('queryPage.makeDecision')}
        </button>
      </div>
    </div>
  )
}

function SqlEditorCard({
  editorKey,
  schema,
  initialValue,
  onRun,
  onCancel,
  runLabel,
  subtitle,
  emphasized,
}: {
  editorKey: string
  schema?: DataSourceSchema
  initialValue?: string
  onRun: (sql: string) => Promise<QueryError | null>
  onCancel?: () => void
  runLabel: string
  subtitle?: string
  emphasized?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={`rounded-2xl border ${emphasized ? 'border-accent/30' : 'border-line'} bg-surface p-4 shadow-card`}
    >
      <div className="mb-3 flex items-center gap-2">
        <Code2 size={14} className="text-accent" />
        <span className="eyebrow text-accent">{t('queryPage.sqlEditor')}</span>
        {subtitle && <span className="text-xs text-ink-faint">{subtitle}</span>}
      </div>
      <SQLEditor
        key={editorKey}
        schema={schema}
        initialValue={initialValue}
        onRun={onRun}
        onCancel={onCancel}
        runLabel={runLabel}
      />
    </div>
  )
}

function ModeToggle({ mode, onChange }: { mode: 'nl' | 'sql'; onChange: (m: 'nl' | 'sql') => void }) {
  const { t } = useTranslation()
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition'
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      <button
        onClick={() => onChange('nl')}
        aria-pressed={mode === 'nl'}
        className={`${base} ${mode === 'nl' ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'}`}
      >
        <Sparkles size={13} /> {t('queryPage.naturalLanguage')}
      </button>
      <button
        onClick={() => onChange('sql')}
        aria-pressed={mode === 'sql'}
        className={`${base} ${mode === 'sql' ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'}`}
      >
        <Code2 size={13} /> SQL
      </button>
    </div>
  )
}

function LoadingState() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
        {t('queryPage.loadingData')}
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-line bg-surface" />
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="plot-grid grid min-h-[50vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-lg text-ink">{t('queryPage.emptyTitle')}</p>
      <p className="mt-1 text-sm text-ink-soft">
        {t('queryPage.emptySubtitle')}
      </p>
    </div>
  )
}
