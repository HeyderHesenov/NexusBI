import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ForceGraph } from './ForceGraph'
import type { GraphData } from '../../types'

const DATA: GraphData = {
  nodes: [
    { id: 'ds:demo', type: 'ds', label: 'Demo', ref_id: null },
    { id: 'table:sales', type: 'table', label: 'sales', ref_id: null },
    { id: 'widget:w1', type: 'widget', label: 'W1', ref_id: 'w1' },
  ],
  edges: [
    { source: 'ds:demo', target: 'table:sales', kind: 'hosts' },
    { source: 'table:sales', target: 'widget:w1', kind: 'feeds' },
  ],
}

const base = {
  data: DATA,
  selectedId: null,
  highlight: null,
  hiddenTypes: new Set<never>(),
  showMiniMap: false,
  onSelect: () => {},
}

describe('ForceGraph edge-kind filter', () => {
  it('drops edges whose kind is hidden, keeps the rest', () => {
    const { container, rerender } = render(<ForceGraph {...base} />)
    expect(container.querySelectorAll('[data-edge-kind="feeds"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-edge-kind="hosts"]')).toHaveLength(1)

    rerender(<ForceGraph {...base} hiddenKinds={new Set(['feeds'])} />)
    expect(container.querySelectorAll('[data-edge-kind="feeds"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-edge-kind="hosts"]')).toHaveLength(1)
  })
})

describe('ForceGraph context menus', () => {
  it('fires node, edge and canvas right-click callbacks', () => {
    const onNode = vi.fn()
    const onEdge = vi.fn()
    const onCanvas = vi.fn()
    const { container } = render(
      <ForceGraph
        {...base}
        onNodeContextMenu={onNode}
        onEdgeContextMenu={onEdge}
        onCanvasContextMenu={onCanvas}
      />,
    )

    fireEvent.contextMenu(container.querySelector('[data-node-id="ds:demo"]')!)
    expect(onNode).toHaveBeenCalledWith('ds:demo', expect.anything())

    // The transparent fat hit-path only renders when an edge handler is wired.
    fireEvent.contextMenu(container.querySelector('[data-edge-hit]')!)
    expect(onEdge).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.any(String), target: expect.any(String) }),
      expect.anything(),
    )

    fireEvent.contextMenu(container.querySelector('[data-testid="force-graph"]')!)
    expect(onCanvas).toHaveBeenCalled()
  })
})
