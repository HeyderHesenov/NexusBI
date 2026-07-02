import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../store/themeStore'

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
        if (alive) setSvg(rendered)
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
        <p role="alert" className="mb-2 text-xs text-[#D87C6B]">
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
      // Safe: mermaid output under securityLevel 'strict' + server sanitizer rejected
      // markup/click/directives before this code ever reached the client.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
