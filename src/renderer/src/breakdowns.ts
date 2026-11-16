import {
  addUsage,
  agentName,
  ZERO_USAGE,
  type FileTouch,
  type GraphNode,
  type SessionGraph,
  type Usage,
} from '@shared/session'

/** The Tokens & cost and Files screens' sums, worked out from the graph. Pure. */

export interface UsageRow {
  key: string
  label: string
  requests: number
  usage: Usage
  costUsd: number | null
}

function sumRequests(
  nodes: readonly GraphNode[],
  keyOf: (node: GraphNode) => { key: string; label: string },
): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  for (const node of nodes) {
    if (!node.request?.hasReply) continue
    const { key, label } = keyOf(node)
    const row = rows.get(key) ?? { key, label, requests: 0, usage: { ...ZERO_USAGE }, costUsd: 0 }
    row.requests += 1
    row.usage = addUsage(row.usage, node.request.usage)
    row.costUsd = row.costUsd === null || node.request.costUsd === null ? null : row.costUsd + node.request.costUsd
    rows.set(key, row)
  }
  return [...rows.values()].sort((a, b) => (b.costUsd ?? Infinity) - (a.costUsd ?? Infinity))
}

export function byAgent(graph: SessionGraph): UsageRow[] {
  const names = new Map(graph.agents.map((a) => [a.id, a.id === 'main' ? 'main' : agentName(a.type, a.description)]))
  return sumRequests(graph.nodes, (n) => ({ key: n.agentId, label: names.get(n.agentId) ?? n.agentId }))
}

export function bySkill(graph: SessionGraph): UsageRow[] {
  return sumRequests(graph.nodes, (n) => ({ key: n.skill ?? '', label: n.skill ?? '(no skill active)' }))
}

export interface ToolRow {
  name: string
  uses: number
  errors: number
  bytesIn: number
  bytesOut: number
  durationMs: number
}

/** Tools are not charged for directly; what they cost is the data they send back into later requests. */
export function byTool(graph: SessionGraph): ToolRow[] {
  const rows = new Map<string, ToolRow>()
  for (const node of graph.nodes) {
    if (!node.tool) continue
    const row = rows.get(node.tool.name) ?? {
      name: node.tool.name,
      uses: 0,
      errors: 0,
      bytesIn: 0,
      bytesOut: 0,
      durationMs: 0,
    }
    row.uses += 1
    row.errors += node.error ? 1 : 0
    row.bytesIn += node.bytesIn
    row.bytesOut += node.bytesOut
    row.durationMs += node.endedAt - node.startedAt
    rows.set(node.tool.name, row)
  }
  return [...rows.values()].sort((a, b) => b.bytesOut - a.bytesOut)
}

export interface FileRow {
  path: string
  counts: Record<FileTouch['action'], number>
  agentIds: string[]
  /** In the order they happened. */
  touches: GraphNode[]
}

export function byFile(graph: SessionGraph): FileRow[] {
  const rows = new Map<string, FileRow>()
  for (const node of graph.nodes) {
    const file = node.tool?.file
    if (!file) continue
    const row = rows.get(file.path) ?? {
      path: file.path,
      counts: { read: 0, write: 0, edit: 0, delete: 0 },
      agentIds: [],
      touches: [],
    }
    row.counts[file.action] += 1
    if (!row.agentIds.includes(node.agentId)) row.agentIds.push(node.agentId)
    row.touches.push(node)
    rows.set(file.path, row)
  }
  const changes = (r: FileRow): number => r.counts.write + r.counts.edit + r.counts.delete
  return [...rows.values()].sort(
    (a, b) => changes(b) - changes(a) || b.touches.length - a.touches.length || a.path.localeCompare(b.path),
  )
}
