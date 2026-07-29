import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatNavBadge } from './ChatNavBadge'
import { useChatUnreadStore } from '../../store/chatUnreadStore'

const seed = (rooms: Record<string, number>) => useChatUnreadStore.setState({ rooms })

beforeEach(() => seed({}))

describe('ChatNavBadge', () => {
  it('renders nothing when everything is read', () => {
    const { container } = render(<ChatNavBadge />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sums unread across every room — the badge spans all workspaces', () => {
    seed({ 'ws:1:channel:a': 2, 'dm:x:y': 3 })
    render(<ChatNavBadge />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('caps a busy count so the nav item cannot be pushed around', () => {
    seed({ 'dm:x:y': 240 })
    render(<ChatNavBadge />)
    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('announces the count to screen readers', () => {
    seed({ 'dm:x:y': 2 })
    render(<ChatNavBadge />)
    expect(screen.getByLabelText(/2/)).toBeInTheDocument()
  })
})
