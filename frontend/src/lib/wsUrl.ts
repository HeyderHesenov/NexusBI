/**
 * One place that knows how to reach the backend, for HTTP and for WebSockets.
 *
 * Three stores used to derive the socket origin themselves with the same line:
 *
 *     apiBase.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '')
 *
 * That works only while `VITE_API_URL` is absolute. A production image wants it
 * relative (`/api/v1`) so one build can be deployed behind any domain — and then
 * the `^http` anchor never matches, the base collapses to `''`, and
 * `new WebSocket('/ws/user?...')` throws a SyntaxError, because the WebSocket
 * constructor has no notion of a relative URL. Resolving against
 * `window.location` first fixes that and leaves absolute values untouched.
 */

const DEFAULT_API_BASE = 'http://localhost:8000/api/v1'

/** The configured API base, exactly as the app should call it. */
export function apiBase(): string {
  return import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE
}

/**
 * The WebSocket origin, with no trailing `/api/v1` and no trailing slash.
 *
 * Sockets are mounted at `/ws/*` on the app root, not under the API prefix, so
 * the prefix is stripped rather than kept.
 */
export function wsBase(base: string = apiBase()): string {
  // `window.location.origin` only matters for relative values; absolute ones
  // ignore it. In a non-browser context (SSR, a test without jsdom) fall back to
  // the dev default so this never throws at import time.
  const origin = typeof window !== 'undefined' ? window.location.origin : DEFAULT_API_BASE
  const url = new URL(base, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = url.pathname.replace(/\/api\/v1\/?$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}
