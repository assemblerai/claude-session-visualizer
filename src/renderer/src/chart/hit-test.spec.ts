import { describe, expect, it } from 'vitest'
import { loadGraph } from './fixtures'
import { distanceToEdge, edgeAt, neighbour, nodeAt } from './hit-test'
import { layout, type EdgePath, type Placed } from './layout'

const placed = layout(loadGraph('one-helper'), 'ordered')

describe('nodeAt', () => {
  it('finds each node at its centre, and nothing in a gap', () => {
    for (const n of placed.nodes) expect(nodeAt(placed, n.x + n.w / 2, n.y + n.h / 2)).toBe(n)

    expect(nodeAt(placed, -50, -50)).toBeNull()
    const first = placed.nodes[0] as Placed
    expect(nodeAt(placed, first.x + first.w + 3, first.y + first.h / 2)).toBeNull()
  })
})

describe('edgeAt', () => {
  const edge = placed.edges.find((e) => e.y1 !== e.y2) as EdgePath

  it.each([
    ['at its start', edge.x1 + 1, edge.y1, true],
    ['at its end', edge.x2 - 1, edge.y2, true],
    ['far above it', (edge.x1 + edge.x2) / 2, Math.min(edge.y1, edge.y2) - 400, false],
  ])('answers for a point %s', (_, x, y, found) => {
    expect(edgeAt(placed, x, y, 4) !== null).toBe(found)
  })

  it('measures distance along the curve, not the straight line', () => {
    expect(distanceToEdge(edge, edge.x1, edge.y1)).toBeLessThan(0.01)
    expect(distanceToEdge(edge, (edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2)).toBeLessThan(1)
  })
})

describe('neighbour', () => {
  const trunk = placed.nodes.filter((n) => n.node.agentId === 'main')
  const helper = placed.nodes.filter((n) => n.node.agentId !== 'main')

  it.each([
    ['right moves along the run', (trunk[0] as Placed).node.id, 'right', (trunk[1] as Placed).node.id],
    ['left moves back along it', (trunk[1] as Placed).node.id, 'left', (trunk[0] as Placed).node.id],
    ['left stops at the start', (trunk[0] as Placed).node.id, 'left', null],
    ['up from a helper reaches the trunk', (helper[0] as Placed).node.id, 'up', 'main'],
    ['up from the trunk goes nowhere', (trunk[0] as Placed).node.id, 'up', null],
  ] as const)('%s', (_, from, direction, expected) => {
    const next = neighbour(placed, from, direction)

    if (expected === 'main') expect(next?.node.agentId).toBe('main')
    else expect(next?.node.id ?? null).toBe(expected)
  })

  it('starts at the first node when nothing is selected', () => {
    expect(neighbour(placed, null, 'right')).toBe(placed.nodes[0])
  })

  it('moves down from the trunk to the nearest step of the helper below', () => {
    const spawn = placed.byId.get('tool:toolu_017o5XoyyRBrxPmJHaxBhpuC') as Placed

    expect(neighbour(placed, spawn.node.id, 'down')?.node.agentId).toBe('ab264e6e0b102cad4')
  })
})
