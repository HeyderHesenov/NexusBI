import { useEffect, useRef } from 'react'

/** Any `useRef` holding an element — accepts refs typed to a concrete tag. */
type ElementRef = { readonly current: HTMLElement | null }

interface Options {
  /** Scrolling inside this element is the panel's own overflow list, not a reflow. */
  ignoreWithin?: ElementRef
  /** The element the panel is anchored under. With one, a scroll only dismisses
   *  once the anchor has actually moved. Cursor-anchored menus have none, and so
   *  still dismiss on any scroll. */
  anchorRef?: ElementRef
}

/**
 * Dismiss a floating panel when the page reflows out from under it.
 *
 * A `position: fixed` panel is placed once, from its anchor's rect at open time,
 * so scrolling or resizing would strand it — hence dismissing on both.
 *
 * The trap this hook exists to close: scroll events are not dispatched
 * synchronously. They fire during the next "update the rendering" pass, so a
 * scroll that ran just *before* the panel opened — a test driver, or the browser
 * itself, bringing the trigger into view and then clicking it — is delivered once
 * the panel is already open, and reads as "the user scrolled away" a frame after
 * they opened it. Comparing the anchor's rect against where it was when the panel
 * opened tells the two apart: a pre-open scroll has already been applied to the
 * layout by then, so the anchor has not moved and the event is ignored. It also
 * means scrolling an unrelated container no longer closes the panel.
 *
 * (Arming the listeners one frame late looks like the obvious fix and is not:
 * `requestAnimationFrame` can be starved for a long time in a headless browser
 * that is producing no frames, which silently disables the dismissal entirely.)
 *
 * Shared by ActionMenu, ContextMenu and the dashboard pill menu so the three
 * can't drift apart — this went wrong in all three at once.
 */
export function useReflowDismiss(
  active: boolean,
  onDismiss: () => void,
  { ignoreWithin, anchorRef }: Options = {},
) {
  // Read the latest callback via a ref so the effect depends on `active` alone;
  // callers pass inline arrows, and re-running would reset the anchor baseline.
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  useEffect(() => {
    if (!active) return
    // Measured with the panel already open, so whatever scrolling led to it
    // opening is baked in rather than counted as movement.
    const opened = anchorRef?.current?.getBoundingClientRect()
    const anchor = opened ? { top: opened.top, left: opened.left } : null

    const onScroll = (e: Event) => {
      if (ignoreWithin?.current?.contains(e.target as Node)) return
      const now = anchorRef?.current?.getBoundingClientRect()
      if (
        anchor &&
        now &&
        Math.abs(now.top - anchor.top) < 1 &&
        Math.abs(now.left - anchor.left) < 1
      )
        return
      onDismissRef.current()
    }
    const onResize = () => onDismissRef.current()

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [active, ignoreWithin, anchorRef])
}
