import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Deep-link handler for `?open=<id>` (copilot chips): load the page's data
 * once, select the referenced object, then strip the param. The consumed-ref
 * keeps the effect from re-firing (and re-loading) when clearing the param
 * changes the searchParams identity. */
export function useOpenParam(
  load: () => Promise<unknown>,
  select: (id: string) => void,
): void {
  const [searchParams, setSearchParams] = useSearchParams()
  const consumed = useRef(false)

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const openId = searchParams.get('open')
    load()
      .then(() => {
        if (openId) {
          select(openId)
          setSearchParams({}, { replace: true })
        }
      })
      .catch(() => undefined)
  }, [load, select, searchParams, setSearchParams])
}
