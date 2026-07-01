import { lazy, Suspense } from 'react'
import type { ComponentProps } from 'react'
import type { SQLEditorInner } from './SQLEditorInner'

// CodeMirror (~200kB with lang-sql) stays out of the initial route chunk — it
// arrives only when a user opens the SQL editor, mirroring LazyChartRenderer.
const Inner = lazy(() => import('./SQLEditorInner').then((m) => ({ default: m.SQLEditorInner })))

function EditorSkeleton() {
  return <div className="h-32 animate-pulse rounded-xl border border-line bg-surface-2" />
}

/** Deferred, theme-matched SQL editor. Drop-in for SQLEditorInner. */
export function SQLEditor(props: ComponentProps<typeof SQLEditorInner>) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Inner {...props} />
    </Suspense>
  )
}
