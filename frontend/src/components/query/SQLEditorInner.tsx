import { autocompletion } from '@codemirror/autocomplete'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { SQLite, sql } from '@codemirror/lang-sql'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { AlertTriangle, Play, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataSourceSchema } from '../../types'

export interface SQLRunError {
  message: string
  detail?: string | null
}

interface Props {
  initialValue?: string
  /** Active source schema → drives table/column autocomplete. */
  schema?: DataSourceSchema
  /** Runs the SQL; returns an error to show inline, or null on success. */
  onRun: (sql: string) => Promise<SQLRunError | null>
  onCancel?: () => void
  runLabel?: string
}

// Theme built on the app's CSS-variable tokens so it re-themes with light/dark.
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'rgb(var(--surface-2))',
    borderRadius: '12px',
    border: '1px solid rgb(var(--line))',
  },
  '&.cm-focused': { outline: 'none', borderColor: 'rgb(var(--accent))' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace', lineHeight: '1.6' },
  '.cm-content': { color: 'rgb(var(--ink))', caretColor: 'rgb(var(--accent))', padding: '12px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'rgb(var(--accent))' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'rgb(var(--ink-faint))' },
  '.cm-activeLine': { backgroundColor: 'rgb(var(--surface) / 0.6)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'rgb(var(--ink-soft))' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgb(var(--accent) / 0.22)',
  },
  '.cm-tooltip': {
    backgroundColor: 'rgb(var(--surface))',
    border: '1px solid rgb(var(--line))',
    borderRadius: '10px',
    color: 'rgb(var(--ink))',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgb(var(--accent) / 0.18)',
    color: 'rgb(var(--ink))',
  },
})

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'rgb(var(--accent))', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'rgb(var(--ink-soft))' },
  { tag: t.comment, color: 'rgb(var(--ink-faint))', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'rgb(var(--accent))' },
  { tag: [t.operator, t.punctuation, t.separator], color: 'rgb(var(--ink-faint))' },
])

export function SQLEditorInner({ initialValue, schema, onRun, onCancel, runLabel = 'İşlət' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<SQLRunError | null>(null)
  const runningRef = useRef(false)

  // Stable + ref-based, so the CodeMirror keymap (captured once at mount) and the
  // Run button share ONE implementation with a working re-entrancy guard.
  const execute = useCallback(() => {
    const doc = viewRef.current?.state.doc.toString() ?? ''
    if (!doc.trim() || runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setErr(null)
    onRunRef.current(doc)
      .then((e) => setErr(e))
      .finally(() => {
        runningRef.current = false
        setRunning(false)
      })
  }, [])

  // Mount the editor once — the parent remounts (via key) when prefilling a new
  // SQL, so schema/initialValue captured here are always current for this open.
  useEffect(() => {
    if (!hostRef.current) return
    const schemaMap: Record<string, string[]> = {}
    if (schema) for (const [table, cols] of Object.entries(schema)) schemaMap[table] = cols.map((c) => c.name)
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValue ?? '',
        extensions: [
          basicSetup,
          sql({ dialect: SQLite, schema: schemaMap, upperCaseKeywords: true }),
          autocompletion(),
          syntaxHighlighting(highlight),
          editorTheme,
          EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-Enter', preventDefault: true, run: () => (execute(), true) }]),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div ref={hostRef} className="overflow-hidden rounded-xl" />

      {err && (
        <div className="space-y-1 rounded-xl border border-[#D87C6B]/40 bg-[#D87C6B]/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-[#D87C6B]" />
            <p className="text-sm font-medium text-ink">{err.message}</p>
          </div>
          {err.detail && <p className="font-mono text-[11px] text-ink-soft">{err.detail}</p>}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={execute}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-press active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={14} /> {running ? 'İşləyir…' : runLabel}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
          >
            <X size={14} /> Ləğv et
          </button>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-faint">⌘↵ ilə işlət</span>
      </div>
    </div>
  )
}
