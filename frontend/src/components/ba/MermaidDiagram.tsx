import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../store/themeStore'
import { sanitizeSvg } from '../../lib/svgSanitize'

let seq = 0

/** Lazy mermaid renderer. The library (~1MB) loads on first diagram render,
 * with securityLevel 'strict' on top of the server-side sanitizer. A parse
 * error falls back to showing the raw code — never a crash. */
export function MermaidDiagram({ code }: { code: string }) {
  const { t } = useTranslation()
  const mode = useThemeStore((s) => s.mode)
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSvg(null)
    setFailed(false)
    // Fresh id per render call: overlapping renders (fast artifact switches)
    // must never collide on mermaid's temporary DOM node.
    const renderId = `ba-mmd-${++seq}`
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: mode === 'dark' ? 'dark' : 'neutral',
          fontFamily: 'Inter, sans-serif',
        })
        const { svg: rendered } = await mermaid.render(renderId, code)
        // Third defense layer: strip any <script>/on*/javascript: that survived
        // the server sanitizer + strict mode. If sanitizing yields nothing
        // renderable, fall through to the raw-code fallback instead of blanking.
        const clean = sanitizeSvg(rendered)
        if (alive) {
          if (clean) setSvg(clean)
          else setFailed(true)
        }
      } catch {
        // mermaid leaves its temp measurement node in <body> on a parse error.
        document.getElementById(`d${renderId}`)?.remove()
        document.getElementById(renderId)?.remove()
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [code, mode])

  if (failed) {
    return (
      <div>
        <p role="alert" className="mb-2 text-xs text-danger">
          {t('baStudio.mermaidError')}
        </p>
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-4 font-mono text-xs text-ink-soft">
          {code}
        </pre>
      </div>
    )
  }
  if (svg === null) {
    return (
      <div
        role="status"
        aria-label={t('common.loading')}
        className="h-40 animate-pulse rounded-xl bg-surface-2"
        data-testid="mermaid-loading"
      />
    )
  }
  return (
    <div
      className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-4 [&_svg]:mx-auto [&_svg]:max-w-full"
      data-testid="mermaid-diagram"
      // Safe: server sanitizer + mermaid securityLevel 'strict' + client-side
      // sanitizeSvg() (script/on*/javascript: stripped) — three layers before inject.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
