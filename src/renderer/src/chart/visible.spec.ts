import { describe, expect, it } from 'vitest'
import { GRAPH_FIXTURES, loadGraph } from './fixtures'
import { attachmentsOf, chartGraph, isAttachment } from './visible'

describe('chartGraph', () => {
  it.each(GRAPH_FIXTURES)('%s: draws no attachment node, and no arrow to a node it does not draw', (name) => {
    const graph = loadGraph(name)
    const shown = chartGraph(graph)
    const joined = new Set(graph.edges.filter((e) => e.kind === 'join').map((e) => e.to))
    expect(shown.nodes.filter((n) => isAttachment(n) && !joined.has(n.id))).toEqual([])
    const ids = new Set(shown.nodes.map((n) => n.id))
    for (const e of shown.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true)
    expect(shown.nodes.filter((n) => !isAttachment(n))).toEqual(graph.nodes.filter((n) => !isAttachment(n)))
  })

  it('keeps injected text, task notifications and compaction summaries on the chart', () => {
    const shown = chartGraph(loadGraph('nested'))
    expect(shown.nodes.some((n) => n.kind === 'context' && n.context?.source === 'message')).toBe(true)
  })
})

describe('attachmentsOf', () => {
  it('lists every hidden attachment under exactly one request', () => {
    const graph = loadGraph('nested')
    const shownIds = new Set(chartGraph(graph).nodes.map((n) => n.id))
    const hidden = graph.nodes.filter((n) => !shownIds.has(n.id)).map((n) => n.id)
    const listed = graph.nodes
      .filter((n) => n.kind === 'request')
      .flatMap((r) => attachmentsOf(graph, r.id).map((n) => n.id))
    expect(hidden.length).toBeGreaterThan(0)
    expect(new Set(listed).size).toBe(listed.length)
    for (const id of hidden) expect(listed).toContain(id)
  })
})
