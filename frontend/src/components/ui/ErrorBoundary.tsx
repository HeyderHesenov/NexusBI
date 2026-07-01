import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

interface Props {
  children: ReactNode
  /** When any value here changes, the boundary auto-resets (e.g. route path). */
  resetKeys?: unknown[]
  /** Compact variant for a single widget; default is a full-panel card. */
  variant?: 'panel' | 'widget'
  /** Optional label shown in the fallback ("Dashboard", "Qrafik"…). */
  label?: string
  /** Injected translator (from the functional wrapper). */
  t: TFunction
}

interface State {
  error: Error | null
}

/** Catches render/runtime errors in its subtree so one broken chart, widget, or
 * route can't white-screen the whole app. Auto-resets when `resetKeys` change. */
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured-ish console log; a real Sentry/OTel hook would plug in here.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !shallowEqual(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    const { variant = 'panel', label, t } = this.props
    const title = label
      ? t('errorBoundary.titleWithLabel', { label })
      : t('errorBoundary.titleGeneric')
    return (
      <div
        role="alert"
        className={
          variant === 'widget'
            ? 'flex h-full flex-col items-center justify-center gap-2 p-4 text-center'
            : 'flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface p-8 text-center'
        }
      >
        <AlertTriangle size={variant === 'widget' ? 18 : 24} className="text-[#D87C6B]" />
        <p className="text-sm font-medium text-ink">{title}</p>
        {variant === 'panel' && (
          <p className="max-w-sm text-sm text-ink-soft">
            {t('errorBoundary.panelDescription')}
          </p>
        )}
        <button
          onClick={this.reset}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft transition hover:bg-surface-2 hover:text-ink"
        >
          <RotateCcw size={14} /> {t('errorBoundary.retry')}
        </button>
      </div>
    )
  }
}

/** Functional wrapper: supplies the translator to the class boundary so the
 * error UI is localized while keeping class-based error catching. */
export function ErrorBoundary(props: Omit<Props, 't'>) {
  const { t } = useTranslation()
  return <ErrorBoundaryInner {...props} t={t} />
}

function shallowEqual(a?: unknown[], b?: unknown[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((v, i) => Object.is(v, b[i]))
}
