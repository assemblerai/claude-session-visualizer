import type { GraphNode, SessionGraph } from '@shared/session'

/** Context Claude Code attached on its own: listed in the details panel under its request, not drawn. */
export const isAttachment = (node: GraphNode): boolean =>
  node.kind === 'context' && node.context?.source === 'attachment'

/**
 * The graph as the chart draws it: without attachment nodes and their arrows.
 * A node an agent's report joins at stays, so a helper's line never ends in mid-air.
 */
export function chartGraph(graph: SessionGraph): SessionGraph {
  const joined = new Set(graph.edges.filter((e) => e.kind === 'join').map((e) => e.to))
  const hidden = new Set(graph.nodes.filter((n) => isAttachment(n) && !joined.has(n.id)).map((n) => n.id))
  if (hidden.size === 0) return graph
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !hidden.has(n.id)),
    edges: graph.edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to)),
  }
}

/** The attachment nodes that went into a request, in the order they were attached. */
export function attachmentsOf(graph: SessionGraph, requestId: string): GraphNode[] {
  const from = new Set(graph.edges.filter((e) => e.to === requestId && e.kind === 'flow').map((e) => e.from))
  return graph.nodes.filter((n) => from.has(n.id) && isAttachment(n))
}
