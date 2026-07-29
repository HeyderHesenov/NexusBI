import { describe, expect, it } from 'vitest'
import { wsBase } from './wsUrl'

// jsdom serves these from http://localhost:3000 by default; the relative cases
// resolve against that origin, which is exactly what a deployed page does.

describe('wsBase', () => {
  it('keeps working for an absolute http base (the dev default)', () => {
    expect(wsBase('http://localhost:8000/api/v1')).toBe('ws://localhost:8000')
  })

  it('upgrades an absolute https base to wss', () => {
    expect(wsBase('https://bi.example.com/api/v1')).toBe('wss://bi.example.com')
  })

  it('resolves a relative base against the page origin', () => {
    // The production build ships VITE_API_URL=/api/v1 so one image serves any
    // domain. The old `.replace(/^http/, 'ws')` produced '' here, and
    // `new WebSocket('/ws/user')` throws on a relative URL.
    expect(wsBase('/api/v1')).toBe(`ws://${window.location.host}`)
  })

  it('strips the api prefix whether or not it has a trailing slash', () => {
    expect(wsBase('http://localhost:8000/api/v1/')).toBe('ws://localhost:8000')
  })

  it('keeps a path prefix that is not the api mount', () => {
    // Someone hosting NexusBI under a sub-path still needs it in the socket URL.
    expect(wsBase('https://example.com/nexusbi/api/v1')).toBe('wss://example.com/nexusbi')
  })

  it('never returns a trailing slash, so callers can concatenate /ws/...', () => {
    expect(wsBase('https://example.com/api/v1')).not.toMatch(/\/$/)
    expect(wsBase('/api/v1')).not.toMatch(/\/$/)
  })
})
