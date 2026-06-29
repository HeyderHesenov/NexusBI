import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteHistoryItem = vi.fn()
vi.mock('../store/queryStore', () => ({
  useQueryStore: (sel: (s: { deleteHistoryItem: typeof deleteHistoryItem }) => unknown) =>
    sel({ deleteHistoryItem }),
}))

import { useHistoryDelete } from './useHistoryDelete'

beforeEach(() => deleteHistoryItem.mockReset())

describe('useHistoryDelete', () => {
  it('opens and closes the context menu', () => {
    const { result } = renderHook(() => useHistoryDelete())
    const preventDefault = vi.fn()
    act(() =>
      result.current.openMenu('q1', { preventDefault, clientX: 10, clientY: 20 } as never),
    )
    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.menu).toEqual({ id: 'q1', x: 10, y: 20 })
    act(() => result.current.closeMenu())
    expect(result.current.menu).toBeNull()
  })

  it('tracks the confirm target', () => {
    const { result } = renderHook(() => useHistoryDelete())
    act(() => result.current.askDelete('q2'))
    expect(result.current.confirmId).toBe('q2')
    act(() => result.current.cancelDelete())
    expect(result.current.confirmId).toBeNull()
  })

  it('confirmDelete deletes the confirmed id', async () => {
    const { result } = renderHook(() => useHistoryDelete())
    act(() => result.current.askDelete('q3'))
    await act(async () => {
      await result.current.confirmDelete()
    })
    expect(deleteHistoryItem).toHaveBeenCalledWith('q3')
  })

  it('confirmDelete is a no-op with nothing confirmed', async () => {
    const { result } = renderHook(() => useHistoryDelete())
    await act(async () => {
      await result.current.confirmDelete()
    })
    expect(deleteHistoryItem).not.toHaveBeenCalled()
  })
})
