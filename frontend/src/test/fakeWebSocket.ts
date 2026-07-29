import { vi } from 'vitest'

/** Minimal fake WebSocket: records instances and never auto-fires handlers, so a
 * test drives onopen/onmessage/onclose explicitly and nothing happens by timing.
 * Shared by every socket store's tests — each one used to carry its own copy. */
export class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  url: string
  readyState = FakeWS.OPEN
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}

/** Swap in FakeWS for the duration of a suite. Returns helpers for the common moves. */
export function installFakeWebSocket() {
  const original = globalThis.WebSocket
  globalThis.WebSocket = FakeWS as unknown as typeof WebSocket
  FakeWS.instances = []
  return {
    restore: () => {
      globalThis.WebSocket = original
    },
    /** The most recently constructed socket. */
    last: () => FakeWS.instances[FakeWS.instances.length - 1],
    all: () => FakeWS.instances,
    /** Deliver a server frame to a socket. */
    emit: (ws: FakeWS, frame: unknown) => ws.onmessage?.({ data: JSON.stringify(frame) }),
  }
}

/** jsdom hardcodes visibilityState to 'visible' via a getter — override it. */
export function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Silence the toast side-effect in store tests that only assert state. */
export const toastSpy = () => vi.fn()
