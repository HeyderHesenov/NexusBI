import { describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  client: {
    patch: vi.fn().mockResolvedValue({ data: { id: 'a1', active: false } }),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

import { client } from './client'
import { updateAlert } from './alert'

describe('updateAlert', () => {
  it('PATCHes only the fields it was given', async () => {
    // The verb is part of the contract, not a detail: the backend exposes PATCH
    // and the architecture ratchet requires PATCH routes to carry a rate limit,
    // so a switch to POST/PUT would 405 with nothing in CI to notice.
    await updateAlert('a1', { active: false })
    expect(client.patch).toHaveBeenCalledWith('/alerts/a1', { active: false })
  })
})
