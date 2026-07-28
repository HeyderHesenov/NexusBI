import { beforeEach, describe, expect, it } from 'vitest'
import { clearHint, readHint, saveHint } from './loginHint'

const KEY = 'nexusbi_login_hint'

describe('loginHint', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when nothing is stored', () => {
    expect(readHint()).toBeNull()
  })

  it('round-trips an email-only hint', () => {
    saveHint('demo@nexusbi.io')
    expect(readHint()).toEqual({ email: 'demo@nexusbi.io' })
  })

  it('never writes a password to storage', () => {
    saveHint('demo@nexusbi.io')
    const raw = localStorage.getItem(KEY) ?? ''
    expect(raw).not.toContain('password')
  })

  it('clears a stored hint', () => {
    saveHint('a@b.c')
    clearHint()
    expect(readHint()).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readHint()).toBeNull()
  })

  it('returns null when the shape is wrong (missing email)', () => {
    localStorage.setItem(KEY, JSON.stringify({ foo: 'bar' }))
    expect(readHint()).toBeNull()
  })

  it('purges a legacy {email,password} record to email-only on read', () => {
    localStorage.setItem(KEY, JSON.stringify({ email: 'a@b.c', password: 'secret' }))
    expect(readHint()).toEqual({ email: 'a@b.c' })
    // The plaintext password must be scrubbed from disk, not just ignored.
    expect(localStorage.getItem(KEY) ?? '').not.toContain('password')
    expect(localStorage.getItem(KEY) ?? '').not.toContain('secret')
  })
})
