import { describe, expect, it } from 'vitest'
import type { Agent, GraphEdge, GraphNode, SessionGraph } from '@shared/session'
import { GRAPH_FIXTURES, loadGraph } from './fixtures'
import { inRange, layout, rankNodes, SPACING, type Layout, type LayoutMode, type Placed } from './layout'

const MODES: readonly LayoutMode[] = ['ordered', 'scale']

function overlapping(placed: Layout): [Placed, Placed] | null {
  const byBand = new Map<number, Placed[]>()
  for (const n of placed.nodes) byBand.set(n.band, [...(byBand.get(n.band) ?? []), n])
  for (const nodes of byBand.values()) {
    nodes.sort((a, b) => a.x - b.x)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i] as Placed
      for (let j = i + 1; j < nodes.length && (nodes[j] as Placed).x < a.x + a.w; j++) {
        const b = nodes[j] as Placed
        if (b.y < a.y + a.h && a.y < b.y + b.h) return [a, b]
      }
    }
  }
  return null
}

describe.each(GRAPH_FIXTURES)('layout of %s', (name) => {
  const graph = loadGraph(name)

  it.each(MODES)('places every node, with no two overlapping (%s)', (mode) => {
    const placed = layout(graph, mode)

    expect(placed.nodes).toHaveLength(graph.nodes.length)
    expect(overlapping(placed)).toBeNull()
    for (const n of placed.nodes) expect(n.x + n.w).toBeLessThanOrEqual(placed.width)
  })

  it("puts every arrow's target to the right of its source", () => {
    const placed = layout(graph, 'ordered')

    for (const e of placed.edges) expect(e.x2).toBeGreaterThan(e.x1)
  })

  it('puts every join to the right of the whole branch that joins it', () => {
    const placed = layout(graph, 'ordered')
    for (const agent of graph.agents) {
      agent.runs.forEach((run, k) => {
        const join = run.joinNodeId === null ? undefined : placed.byId.get(run.joinNodeId)
        if (!join) return
        for (const n of placed.nodes) {
          if (n.node.agentId === agent.id && n.node.run === k) expect(join.x).toBeGreaterThanOrEqual(n.x + n.w)
        }
      })
    }
  })

  it('keeps a helper below whoever started it', () => {
    const placed = layout(graph, 'ordered')
    const bandOf = (agentId: string, run: number): number | undefined =>
      placed.bands.find((b) => b.agentId === agentId && b.run === run)?.index

    for (const agent of graph.agents) {
      agent.runs.forEach((run, k) => {
        const spawn = placed.byId.get(run.spawnNodeId)
        expect(bandOf(agent.id, k)).toBeGreaterThan(spawn?.band ?? Infinity)
      })
    }
  })

  it('finds every node through the buckets', () => {
    const placed = layout(graph, 'ordered')

    expect(new Set(inRange(placed.nodeBuckets, 0, placed.width)).size).toBe(placed.nodes.length)
    const first = placed.nodes[0] as Placed
    expect(inRange(placed.nodeBuckets, first.x, first.x + 1).map((i) => placed.nodes[i])).toContain(first)
  })
})

describe('layout, columns', () => {
  it('stacks the tools asked for in one reply in one column', () => {
    const graph = loadGraph('nested')
    const rank = rankNodes(graph)
    const asked = new Map<string, string[]>()
    for (const e of graph.edges) {
      if (e.kind === 'flow' && e.direction === 'in' && e.from.startsWith('req:') && e.to.startsWith('tool:'))
        asked.set(e.from, [...(asked.get(e.from) ?? []), e.to])
    }
    const several = [...asked.values()].filter((tools) => tools.length > 1)

    expect(several.length).toBeGreaterThan(0)
    for (const tools of several) expect(new Set(tools.map((id) => rank.get(id))).size).toBe(1)
  })

  it('makes the chart as wide as the longest path, not the sum of all work', () => {
    const graph = loadGraph('nested')
    const columns = Math.max(...rankNodes(graph).values()) + 1

    expect(columns).toBeLessThan(graph.nodes.length * 0.75)
  })

  it('draws a resumed helper as a second branch in the same colour', () => {
    const placed = layout(loadGraph('nested'), 'ordered')
    const runs = placed.bands.filter((b) => b.agentId === 'a440e649178b9695b')

    expect(runs.map((b) => b.run)).toEqual([0, 1])
    expect(runs[0]?.agentIndex).toBe(runs[1]?.agentIndex)
    expect(runs[1]?.label).toMatch(/\(resumed\)$/)
    expect(runs[1]?.x0).toBeGreaterThan(runs[0]?.x1 ?? Infinity)
  })

  it('runs each branch line between the centres of its first and last steps', () => {
    const placed = layout(loadGraph('nested'), 'ordered')

    for (const band of placed.bands) {
      const steps = placed.nodes.filter((p) => p.node.agentId === band.agentId && p.node.run === band.run)
      const centres = steps.map((p) => p.x + p.w / 2)
      expect(band.lineX0).toBe(Math.min(...centres))
      expect(band.lineX1).toBe(Math.max(...centres))
    }
  })

  it("starts each helper's label at its own first box, not at the step that spawned it", () => {
    const placed = layout(loadGraph('nested'), 'ordered')

    for (const band of placed.bands.filter((b) => b.agentId !== 'main')) {
      const steps = placed.nodes.filter((p) => p.node.agentId === band.agentId && p.node.run === band.run)
      expect(band.labelX).toBe(Math.min(...steps.map((p) => p.x)))
      expect(band.labelX).toBeGreaterThan(band.x0)
    }
  })

  it('leaves the branch of a helper that never reported open', () => {
    const placed = layout(loadGraph('nested'), 'ordered')

    expect(placed.bands.find((b) => b.agentId === 'a3f9dfe69c9529450')?.joined).toBe(false)
  })
})

describe('layout, rows', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
  const totals = { usage, costUsd: 0, requests: 0, toolUses: 0, durationMs: 0 }
  const node = (id: string, kind: GraphNode['kind'], agentId: string, at: number): GraphNode => ({
    id,
    kind,
    agentId,
    run: 0,
    label: id,
    startedAt: at,
    endedAt: at + 1,
    error: false,
    bytesIn: 0,
    bytesOut: 0,
  })
  const edge = (from: string, to: string, kind: GraphEdge['kind'] = 'flow'): GraphEdge => ({
    id: `${from}>${to}`,
    from,
    to,
    kind,
    direction: 'in',
    bytes: 1,
    label: '',
  })

  /** A trunk that runs `count` helpers one after another, each joining before the next starts. */
  function sequential(count: number): SessionGraph {
    const nodes: GraphNode[] = [node('req:0', 'request', 'main', 0)]
    const edges: GraphEdge[] = []
    const agents: Agent[] = [
      {
        id: 'main',
        parentId: null,
        type: 'main',
        description: '',
        depth: 0,
        background: false,
        finished: true,
        runs: [],
        totals,
      },
    ]
    for (let i = 0; i < count; i++) {
      const t = 10 + i * 100
      const id = `h${i}`
      nodes.push(
        node(`tool:${i}`, 'tool', 'main', t),
        node(`agent:${id}:0`, 'agent', id, t + 1),
        node(`req:${id}`, 'request', id, t + 2),
        node(`req:${i + 1}`, 'request', 'main', t + 50),
      )
      edges.push(
        edge(`req:${i}`, `tool:${i}`),
        edge(`tool:${i}`, `agent:${id}:0`, 'spawn'),
        edge(`agent:${id}:0`, `req:${id}`),
        edge(`tool:${i}`, `req:${i + 1}`),
        edge(`req:${id}`, `req:${i + 1}`, 'join'),
      )
      agents.push({
        id,
        parentId: 'main',
        type: 'coder',
        description: '',
        depth: 1,
        background: false,
        finished: true,
        runs: [{ spawnNodeId: `tool:${i}`, headNodeId: `agent:${id}:0`, joinNodeId: `req:${i + 1}` }],
        totals,
      })
    }
    return {
      sessionId: 's',
      title: null,
      startedAt: 0,
      endedAt: 10 + count * 100,
      agents,
      nodes,
      edges,
      skills: [],
      totals,
      byModel: [],
      claudeCodeTotals: null,
      claudeCodeByModel: [],
      warnings: [],
    }
  }

  it('reuses a row once its branch has joined back', () => {
    const placed = layout(sequential(8), 'ordered')

    expect(new Set(placed.bands.map((b) => b.index))).toEqual(new Set([0, 1]))
  })

  it('gives helpers running at the same time rows of their own', () => {
    const graph = sequential(2)
    // Make the first helper report only at the very end: both are now open at once.
    const first = graph.agents[1]?.runs[0]
    const edgeToMove = graph.edges.find((e) => e.kind === 'join' && e.from === 'req:h0')
    if (!first || !edgeToMove) throw new Error('bad test graph')
    first.joinNodeId = 'req:2'
    edgeToMove.to = 'req:2'
    const placed = layout(graph, 'ordered')

    expect(
      placed.bands
        .filter((b) => b.agentId !== 'main')
        .map((b) => b.index)
        .sort(),
    ).toEqual([1, 2])
  })

  it('stacks context a few to a column, so the trunk stays close to its helpers', () => {
    const graph = loadGraph('nested')
    const placed = layout(graph, 'ordered')
    const perColumn = new Map<number, number>()
    for (const n of placed.nodes)
      if (n.node.agentId === 'main' && n.node.kind === 'context') perColumn.set(n.x, (perColumn.get(n.x) ?? 0) + 1)

    expect(graph.nodes.filter((n) => n.agentId === 'main' && n.kind === 'context').length).toBeGreaterThan(
      SPACING.contextStack,
    )
    expect(Math.max(...perColumn.values())).toBeLessThanOrEqual(SPACING.contextStack)
  })

  it('draws a context node at half height', () => {
    const placed = layout(loadGraph('plain'), 'ordered')
    const context = placed.nodes.find((n) => n.node.kind === 'context')
    const request = placed.nodes.find((n) => n.node.kind === 'request')

    expect(context?.h).toBe(SPACING.unitHeight)
    expect(request?.h).toBeGreaterThan((context?.h ?? 0) * 2)
  })

  it('gives each step a width that matches how long it took, in to-scale mode', () => {
    const graph = loadGraph('plain')
    const placed = layout(graph, 'scale')
    const requests = placed.nodes
      .filter((n) => n.node.kind === 'request')
      .sort((a, b) => b.node.endedAt - b.node.startedAt - (a.node.endedAt - a.node.startedAt))
    const longest = requests[0] as Placed
    const shortest = requests[requests.length - 1] as Placed

    expect(longest.w).toBeGreaterThan(shortest.w)
    for (const n of placed.nodes) expect(n.w).toBeGreaterThanOrEqual(SPACING.minScaleWidth)
  })
})
