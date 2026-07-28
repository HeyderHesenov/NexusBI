import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Compass, Database, Grid2x2, Loader2, Shield, Sparkles, Workflow } from 'lucide-react'
import { SavedCard } from '../components/ui/SavedCard'
import { ShareToChatButton } from '../components/chat/ShareToChatButton'
import { useOpenParam } from '../hooks/useOpenParam'
import { useFormatDate } from '../hooks/useFormatDate'
import { ActionMatrix } from '../components/ba/ActionMatrix'
import { BCGMatrix } from '../components/ba/BCGMatrix'
import { EvidenceChips } from '../components/ba/EvidenceChips'
import { MermaidDiagram } from '../components/ba/MermaidDiagram'
import { PorterForces } from '../components/ba/PorterForces'
import { SWOTGrid } from '../components/ba/SWOTGrid'
import { Field, FIELD, Select } from '../components/ui/form'
import { useBAStore } from '../store/baStore'
import { useDatasourceStore } from '../store/datasourceStore'
import type { BAArtifact, BAFramework } from '../types'

const FRAMEWORKS: { key: BAFramework; icon: typeof Grid2x2 }[] = [
  { key: 'swot', icon: Grid2x2 },
  { key: 'porter', icon: Shield },
  { key: 'bcg', icon: Compass },
  { key: 'bpmn', icon: Workflow },
]

// BCG is computed from the connected demo data, not from the context text.
const CONTEXT_REQUIRED: Record<BAFramework, boolean> = {
  swot: true, porter: true, bpmn: true, bcg: false,
}

function ArtifactCanvas({
  artifact,
  onPromote,
}: {
  artifact: BAArtifact
  onPromote: (index: number) => Promise<void>
}) {
  const { t } = useTranslation()
  const c = artifact.content
  const facts = c.facts ?? []
  return (
    <div className="flex flex-col gap-4">
      {/* Provenance first: the numbers this framework was built from, before any prose. */}
      {facts.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface-2 p-4">
          <p className="eyebrow mb-2">{t('baStudio.evidence')}</p>
          <EvidenceChips facts={facts} />
        </div>
      )}

      {artifact.framework === 'swot' && <SWOTGrid content={c} />}
      {artifact.framework === 'porter' && <PorterForces content={c} />}
      {artifact.framework === 'bcg' && <BCGMatrix content={c} />}
      {artifact.framework === 'bpmn' && c.mermaid && (
        <>
          <MermaidDiagram code={c.mermaid} />
          {c.summary && <p className="text-sm text-ink-soft">{c.summary}</p>}
        </>
      )}
      {c.advice && (
        <div className="rounded-2xl border border-accent/30 bg-accent-soft p-4">
          <p className="eyebrow mb-1 flex items-center gap-1.5">
            <Sparkles size={12} /> {t('baStudio.advice')}
          </p>
          <p className="text-sm text-ink">{c.advice}</p>
        </div>
      )}

      {/* The loop out: a framework that produces no tracked action is a dead end. */}
      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="eyebrow mb-3">{t('baStudio.actions')}</p>
        <ActionMatrix actions={c.actions ?? []} onPromote={onPromote} />
      </section>
    </div>
  )
}

export function BAStudioPage() {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const { items, current, generating, load, generate, select, remove, promote } = useBAStore()
  const { sources, load: loadSources } = useDatasourceStore()
  const [framework, setFramework] = useState<BAFramework>('swot')
  const [title, setTitle] = useState('')
  const [context, setContext] = useState('')
  const [datasourceId, setDatasourceId] = useState('')
  // Deep-link from the copilot chip: /ba-studio?open=<artifact_id>
  useOpenParam(load, select)

  useEffect(() => {
    loadSources().catch(() => undefined)
  }, [loadSources])

  const contextMissing = CONTEXT_REQUIRED[framework] && !context.trim()
  // Prefer the name snapshotted at generate time: datasource_id is SET NULL on
  // source deletion, so trusting the FK alone would relabel a real artifact "Demo".
  const sourceName = (a: BAArtifact) =>
    a.content.source_name ??
    (a.datasource_id
      ? (sources.find((s) => s.id === a.datasource_id)?.name ?? a.datasource_id)
      : t('baStudio.sourceDemo'))

  const onGenerate = async () => {
    try {
      await generate(framework, title, context, datasourceId || null)
      toast.success(t('baStudio.generated'))
    } catch {
      /* interceptor shows the API error */
    }
  }

  const onPromote = async (index: number) => {
    if (!current) return
    try {
      await promote(current.id, index)
      toast.success(t('baStudio.promoted'))
    } catch {
      /* interceptor shows the API error */
    }
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('baStudio.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          {t('baStudio.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">{t('baStudio.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* generator form */}
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 lg:col-span-2 lg:self-start">
          <div role="radiogroup" aria-label={t('baStudio.pickFramework')} className="grid gap-2 sm:grid-cols-2">
            {FRAMEWORKS.map(({ key, icon: Icon }, i) => {
              const active = framework === key
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setFramework(key)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                      e.preventDefault()
                      const next = FRAMEWORKS[(i + 1) % FRAMEWORKS.length].key
                      setFramework(next)
                      document.getElementById(`ba-fw-${next}`)?.focus()
                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                      e.preventDefault()
                      const prev = FRAMEWORKS[(i - 1 + FRAMEWORKS.length) % FRAMEWORKS.length].key
                      setFramework(prev)
                      document.getElementById(`ba-fw-${prev}`)?.focus()
                    }
                  }}
                  id={`ba-fw-${key}`}
                  className={`rounded-xl border p-3 text-left transition ${
                    active
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-surface-2 hover:border-ink-faint'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-accent' : 'text-ink-faint'} />
                  <p className="mt-1.5 text-sm font-semibold text-ink">{t(`baStudio.fw_${key}`)}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{t(`baStudio.fw_${key}_desc`)}</p>
                </button>
              )
            })}
          </div>

          {/* Not the shared query DatasourcePicker: that one writes to queryStore,
              so BA Studio would silently share the Ask page's source selection. */}
          <Field id="ba-source" label={t('baStudio.sourceLabel')} hint={t('baStudio.sourceHint')}>
            <Select
              id="ba-source"
              value={datasourceId}
              onChange={(e) => setDatasourceId(e.target.value)}
              options={[
                { value: '', label: t('baStudio.sourceDemo') },
                // Power BI speaks DAX, and the profiler refuses it — keep it out of
                // the list rather than letting the pick fail at generate time.
                ...sources
                  .filter((s) => s.db_type !== 'powerbi')
                  .map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </Field>

          <Field id="ba-title" label={t('baStudio.titleLabel')}>
            <input
              id="ba-title"
              className={FIELD}
              value={title}
              maxLength={255}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t(`baStudio.fw_${framework}`)}
            />
          </Field>

          <Field
            id="ba-context"
            label={t('baStudio.contextLabel')}
            hint={framework === 'bcg' ? t('baStudio.bcgContextHint') : undefined}
          >
            <textarea
              id="ba-context"
              className={`${FIELD} min-h-[140px] resize-y`}
              value={context}
              maxLength={8000}
              onChange={(e) => setContext(e.target.value)}
              placeholder={t(`baStudio.ctx_${framework}`)}
            />
          </Field>

          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || contextMissing}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? t('baStudio.generating') : t('baStudio.generate')}
          </button>
        </section>

        {/* canvas */}
        <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-3">
          {current ? (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="eyebrow">{t(`baStudio.fw_${current.framework}`)}</p>
                  <h2 className="font-display text-lg font-bold text-ink">{current.title}</h2>
                </div>
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-ink-soft"
                  title={t('baStudio.sourceLabel')}
                >
                  <Database size={12} className="text-accent" aria-hidden="true" />
                  {sourceName(current)}
                </span>
              </div>
              <ArtifactCanvas artifact={current} onPromote={onPromote} />
            </>
          ) : (
            <div className="plot-grid grid min-h-[45vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
              <div>
                <Compass size={24} className="mx-auto text-ink-faint" />
                <p className="mt-3 font-display text-lg text-ink">{t('baStudio.emptyTitle')}</p>
                <p className="mt-1 text-sm text-ink-soft">{t('baStudio.emptyBody')}</p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* saved artifacts */}
      {items.length > 0 && (
        <section className="mt-6">
          <p className="eyebrow mb-3">{t('baStudio.saved')}</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <li key={a.id} className="group">
                <SavedCard
                  active={current?.id === a.id}
                  title={a.title}
                  subtitle={`${t(`baStudio.fw_${a.framework}`)} · ${fmtDate(a.created_at, { mode: 'date' })}`}
                  deleteLabel={t('baStudio.delete')}
                  onSelect={() => select(a.id)}
                  onDelete={() =>
                    remove(a.id).then(() => toast.success(t('baStudio.deleted'))).catch(() => undefined)
                  }
                  actions={
                    <ShareToChatButton
                      resourceType="ba_artifact"
                      resourceId={a.id}
                      variant="row"
                      iconSize={14}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
