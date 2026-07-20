import { describe, it, expect } from 'vitest'
import { networkOrErrorToast } from './client'

describe('networkOrErrorToast', () => {
  it('flags an unreachable server with a stable dedupe id', () => {
    // axios network error: no `response` at all
    expect(networkOrErrorToast({})).toEqual({
      message: 'Serverə qoşulmaq mümkün olmadı.',
      id: 'network-error',
    })
    expect(networkOrErrorToast({ response: undefined })).toEqual({
      message: 'Serverə qoşulmaq mümkün olmadı.',
      id: 'network-error',
    })
  })

  it('surfaces a server-provided message, then detail, with no dedupe id', () => {
    expect(networkOrErrorToast({ response: { data: { message: 'Pis SQL' } } })).toEqual({
      message: 'Pis SQL',
    })
    expect(networkOrErrorToast({ response: { data: { detail: 'Tapılmadı' } } })).toEqual({
      message: 'Tapılmadı',
    })
  })

  it('falls back to the generic message for a bodyless HTTP error', () => {
    expect(networkOrErrorToast({ response: { data: {} } })).toEqual({
      message: 'Naməlum xəta baş verdi.',
    })
    expect(networkOrErrorToast({ response: {} })).toEqual({
      message: 'Naməlum xəta baş verdi.',
    })
  })

  it('never dumps a non-string error body into the toast', () => {
    expect(networkOrErrorToast({ response: { data: { detail: [{ msg: 'x' }] } } })).toEqual({
      message: 'Xəta baş verdi.',
    })
  })
})
