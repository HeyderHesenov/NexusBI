import { beforeEach, describe, expect, it } from 'vitest'
import { clearHint, readHint, saveHint } from './loginHint'

const KEY = 'nexusbi_login_hint'

describe('loginHint', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when nothing is stored', () => {
    expect(readHint()).toBeNull()
  })

  it('round-trips a saved hint', () => {
    saveHint('demo@nexusbi.io', 'demo1234')
    expect(readHint()).toEqual({ email: 'demo@nexusbi.io', password: 'demo1234' })
  })

  it('clears a stored hint', () => {
    saveHint('a@b.c', 'x')
    clearHint()
    expect(readHint()).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readHint()).toBeNull()
  })

  it('returns null when the shape is wrong (missing password)', () => {
    localStorage.setItem(KEY, JSON.stringify({ email: 'a@b.c' }))
    expect(readHint()).toBeNull()
  })
})
