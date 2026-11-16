import { agentName, type GraphEdge, type GraphNode, type SessionGraph } from '@shared/session'

/**
 * Where everything goes (docs/technical-design.md section 5). Pure:
 * `layout(graph, mode)` in, positions out. Drawing and hit testing read the
 * result and nothing else.
 */

export type LayoutMode = 'ordered' | 'scale'

/** Spacing, in world pixels. Tuned against real sessions; nothing else depends on the values. */
export const SPACING = {
  nodeWidth: 150,
  /** A full node is two units tall; a context node is one. */
  unitHeight: 22,
  unitGap: 6,
  columnGap: 56,
  bandGap: 34,
  bandPad: 10,
  margin: 40,
  /** To-scale mode: world pixels per millisecond, before the width cap. */
  pxPerMs: 0.05,
  maxScaleWidth: 2_000_000,
  /** To-scale mode: instant steps stay clickable. */
  minScaleWidth: 14,
  bucket: 1024,
  /** How many context nodes stack in one column before the next column starts. */
  contextStack: 5,
} as const

export interface Placed {
  node: GraphNode
  x: number
  y: number
  w: number
  h: number
  band: number
  /** Index into `SessionGraph.agents`: picks the branch colour. */
  agentIndex: number
}

export interface EdgePath {
  edge: GraphEdge
  x1: number
  y1: number
  x2: number
  y2: number
  agentIndex: number
}

/** One run's row: a branch, from where it splits off to where it joins back. */
export interface Band {
  agentId: string
  agentIndex: number
  run: number
  index: number
  x0: number
  x1: number
  y: number
  h: number
  /** The branch line runs between the centres of its first and last steps, so it never juts past either. */
  lineX0: number
  lineX1: number
  /** Left edge of the branch's own first box, where its label starts. (x0 reaches back to the parent's spawning step.) */
  labelX: number
  label: string
  /** False for a helper that never reported back: the branch is left open. */
  joined: boolean
}

export interface Layout {
  mode: LayoutMode
  nodes: Placed[]
  byId: Map<string, Placed>
  edges: EdgePath[]
  bands: Band[]
  width: number
  height: number
  /** Indexes into `nodes` and `edges`, by the x-buckets they touch: culling and hit testing are range lookups. */
  nodeBuckets: number[][]
  edgeBuckets: number[][]
}

const ANCHOR_KINDS = new Set(['request', 'tool', 'mcp-tool', 'result', 'agent'])
const runKey = (agentId: string, run: number): string => `${agentId}:${run}`
const unitsOf = (node: GraphNode): number => (node.kind === 'context' ? 1 : 2)
const heightOf = (units: number): number => units * SPACING.unitHeight + (units - 1) * SPACING.unitGap

/**
 * Columns. A node sits one column right of everything with an edge into it,
 * and of the last step before it on its own run. So tools asked for in one
 * reply share a column, helpers running side by side share columns, and a
 * join target is always right of the whole branch that joins it.
 */
export function rankNodes(graph: SessionGraph): Map<string, number> {
  const into = new Map<string, string[]>()
  for (const e of graph.edges) {
    const list = into.get(e.to)
    if (list) list.push(e.from)
    else into.set(e.to, [e.from])
  }

  const rank = new Map<string, number>()
  // Nodes come nearly sorted, so this settles in a pass or two.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    const lastAnchor = new Map<string, number>()
    const stacks = new Map<string, { base: number; count: number }>()
    for (const node of graph.nodes) {
      const key = runKey(node.agentId, node.run)
      let r = 0
      for (const from of into.get(node.id) ?? []) r = Math.max(r, (rank.get(from) ?? -1) + 1)
      // Tools and results take their column from the request alone, so siblings stack.
      const sequenced = node.kind !== 'tool' && node.kind !== 'mcp-tool' && node.kind !== 'result'
      if (sequenced) r = Math.max(r, (lastAnchor.get(key) ?? -1) + 1)
      if (!ANCHOR_KINDS.has(node.kind)) {
        // Context waiting for the same request stacks, a few to a column, then
        // starts another: a session opens with twenty-odd of them, and one
        // tall stack would push every helper far from the trunk.
        const stack = stacks.get(key)
        if (stack && stack.base === r) {
          stack.count += 1
          r += Math.floor(stack.count / SPACING.contextStack)
        } else stacks.set(key, { base: r, count: 0 })
      }
      if (rank.get(node.id) !== r) {
        rank.set(node.id, r)
        changed = true
      }
      if (ANCHOR_KINDS.has(node.kind)) lastAnchor.set(key, Math.max(lastAnchor.get(key) ?? -1, r))
    }
    if (!changed) break
  }
  return rank
}

function horizontal(graph: SessionGraph, mode: LayoutMode): Map<string, { x: number; w: number }> {
  const at = new Map<string, { x: number; w: number }>()
  if (mode === 'ordered') {
    const rank = rankNodes(graph)
    const step = SPACING.nodeWidth + SPACING.columnGap
    for (const node of graph.nodes) at.set(node.id, { x: SPACING.margin + (rank.get(node.id) ?? 0) * step, w: SPACING.nodeWidth })
    return at
  }
  const duration = Math.max(1, graph.endedAt - graph.startedAt)
  const scale = Math.min(SPACING.pxPerMs, SPACING.maxScaleWidth / duration)
  for (const node of graph.nodes) {
    // An agent node marks where its branch splits off; the branch itself shows how long it ran.
    const timed = node.kind === 'request' || node.kind === 'tool' || node.kind === 'mcp-tool'
    const w = timed ? Math.max(SPACING.minScaleWidth, (node.endedAt - node.startedAt) * scale) : SPACING.minScaleWidth
    at.set(node.id, { x: SPACING.margin + (node.startedAt - graph.startedAt) * scale, w })
  }
  return at
}

interface RunBox {
  agentId: string
  agentIndex: number
  run: number
  parentKey: string | null
  x0: number
  x1: number
  /** Left edge of the run's own first step, before x0 is stretched back to its spawn. */
  left: number
  /** Centres of the first and last steps. */
  c0: number
  c1: number
  nodes: GraphNode[]
  joined: boolean
  band: number
}

/** Rows within a band: each node takes the lowest units free at its x. Answers the units used. */
function pack(nodes: GraphNode[], at: Map<string, { x: number; w: number }>, gap: number): { top: Map<string, number>; units: number } {
  const freeFrom: number[] = []
  const top = new Map<string, number>()
  for (const node of nodes) {
    const pos = at.get(node.id)
    if (!pos) continue
    const need = unitsOf(node)
    let row = 0
    for (;;) {
      let fits = true
      for (let u = row; u < row + need; u++) {
        if ((freeFrom[u] ?? -Infinity) > pos.x) {
          fits = false
          break
        }
      }
      if (fits) break
      row += 1
    }
    for (let u = row; u < row + need; u++) freeFrom[u] = pos.x + pos.w + gap
    top.set(node.id, row)
  }
  return { top, units: Math.max(2, freeFrom.length) }
}

export function layout(graph: SessionGraph, mode: LayoutMode): Layout {
  const at = horizontal(graph, mode)
  const agentIndex = new Map(graph.agents.map((a, i) => [a.id, i]))
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))

  // ---- runs → bands -------------------------------------------------------
  const runs = new Map<string, RunBox>()
  for (const node of graph.nodes) {
    const key = runKey(node.agentId, node.run)
    let box = runs.get(key)
    if (!box) {
      box = { agentId: node.agentId, agentIndex: agentIndex.get(node.agentId) ?? 0, run: node.run, parentKey: null, x0: Infinity, x1: -Infinity, left: Infinity, c0: Infinity, c1: -Infinity, nodes: [], joined: true, band: 0 }
      runs.set(key, box)
    }
    const pos = at.get(node.id)
    if (!pos) continue
    box.nodes.push(node)
    box.x0 = Math.min(box.x0, pos.x)
    box.x1 = Math.max(box.x1, pos.x + pos.w)
    box.left = Math.min(box.left, pos.x)
    box.c0 = Math.min(box.c0, pos.x + pos.w / 2)
    box.c1 = Math.max(box.c1, pos.x + pos.w / 2)
  }
  for (const agent of graph.agents) {
    agent.runs.forEach((run, k) => {
      const box = runs.get(runKey(agent.id, k))
      if (!box) return
      const spawn = nodeById.get(run.spawnNodeId)
      const spawnAt = at.get(run.spawnNodeId)
      const joinAt = run.joinNodeId === null ? undefined : at.get(run.joinNodeId)
      if (spawn) box.parentKey = runKey(spawn.agentId, spawn.run)
      if (spawnAt) box.x0 = Math.min(box.x0, spawnAt.x)
      if (joinAt) box.x1 = Math.max(box.x1, joinAt.x)
      box.joined = run.joinNodeId !== null
    })
  }

  // A band is reused once the run in it has joined back. Runs are placed in
  // the order they start, each in the lowest band below its parent's that is
  // free over its whole length; a resumed helper prefers its first run's band.
  const taken: { x0: number; x1: number }[][] = [[{ x0: -Infinity, x1: Infinity }]]
  const free = (band: number, box: RunBox): boolean => (taken[band] ?? []).every((t) => box.x1 + SPACING.columnGap <= t.x0 || t.x1 + SPACING.columnGap <= box.x0)
  const helperRuns = [...runs.values()].filter((b) => b.agentId !== 'main').sort((a, b) => a.x0 - b.x0 || a.agentIndex - b.agentIndex || a.run - b.run)
  for (const box of helperRuns) {
    const parentBand = box.parentKey === null ? 0 : (runs.get(box.parentKey)?.band ?? 0)
    const preferred = box.run > 0 ? runs.get(runKey(box.agentId, 0))?.band : undefined
    let band = parentBand + 1
    if (preferred !== undefined && preferred > parentBand && free(preferred, box)) band = preferred
    else while (!free(band, box)) band += 1
    box.band = band
    ;(taken[band] ??= []).push({ x0: box.x0, x1: box.x1 })
  }

  // ---- rows within bands, then y -----------------------------------------
  const bandCount = taken.length
  const unitsIn: number[] = new Array<number>(bandCount).fill(2)
  const topOf = new Map<string, number>()
  for (const box of runs.values()) {
    const packed = pack(box.nodes, at, mode === 'ordered' ? SPACING.columnGap / 2 : 2)
    for (const [id, row] of packed.top) topOf.set(id, row)
    unitsIn[box.band] = Math.max(unitsIn[box.band] ?? 2, packed.units)
  }
  const bandY: number[] = []
  const bandH: number[] = []
  let y = SPACING.margin
  for (let i = 0; i < bandCount; i++) {
    bandY.push(y)
    const h = heightOf(unitsIn[i] ?? 2) + 2 * SPACING.bandPad
    bandH.push(h)
    y += h + SPACING.bandGap
  }

  const nodes: Placed[] = []
  const byId = new Map<string, Placed>()
  let width = 0
  for (const node of graph.nodes) {
    const pos = at.get(node.id)
    const box = runs.get(runKey(node.agentId, node.run))
    if (!pos || !box) continue
    const row = topOf.get(node.id) ?? 0
    const placed: Placed = {
      node,
      x: pos.x,
      y: (bandY[box.band] ?? 0) + SPACING.bandPad + row * (SPACING.unitHeight + SPACING.unitGap),
      w: pos.w,
      h: heightOf(unitsOf(node)),
      band: box.band,
      agentIndex: box.agentIndex,
    }
    nodes.push(placed)
    byId.set(node.id, placed)
    width = Math.max(width, placed.x + placed.w)
  }
  width += SPACING.margin
  const height = y - SPACING.bandGap + SPACING.margin

  const bands: Band[] = [...runs.values()].map((box) => {
    const agent = graph.agents[box.agentIndex]
    const label = box.agentId === 'main' ? 'main' : agentName(agent?.type ?? box.agentId, agent?.description)
    return {
      agentId: box.agentId,
      agentIndex: box.agentIndex,
      run: box.run,
      index: box.band,
      x0: box.agentId === 'main' ? SPACING.margin : box.x0,
      x1: box.agentId === 'main' ? width - SPACING.margin : box.x1,
      y: bandY[box.band] ?? 0,
      h: bandH[box.band] ?? 0,
      lineX0: box.c0,
      lineX1: box.c1,
      labelX: box.agentId === 'main' ? SPACING.margin : box.left,
      label: box.run > 0 ? `${label} (resumed)` : label,
      joined: box.joined,
    }
  })

  // ---- edges ---------------------------------------------------------------
  const edges: EdgePath[] = []
  for (const edge of graph.edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    edges.push({
      edge,
      x1: from.x + from.w,
      y1: from.y + from.h / 2,
      x2: to.x,
      y2: to.y + to.h / 2,
      // A spawn and a join are drawn in the helper's colour.
      agentIndex: edge.kind === 'spawn' ? to.agentIndex : from.agentIndex,
    })
  }

  // ---- buckets ---------------------------------------------------------------
  const bucketCount = Math.max(1, Math.ceil(width / SPACING.bucket))
  const fill = (ranges: { x0: number; x1: number }[]): number[][] => {
    const buckets: number[][] = Array.from({ length: bucketCount }, () => [])
    ranges.forEach((r, i) => {
      const a = Math.max(0, Math.floor(Math.min(r.x0, r.x1) / SPACING.bucket))
      const b = Math.min(bucketCount - 1, Math.floor(Math.max(r.x0, r.x1) / SPACING.bucket))
      for (let k = a; k <= b; k++) (buckets[k] as number[]).push(i)
    })
    return buckets
  }

  return {
    mode,
    nodes,
    byId,
    edges,
    bands,
    width,
    height,
    nodeBuckets: fill(nodes.map((n) => ({ x0: n.x, x1: n.x + n.w }))),
    edgeBuckets: fill(edges.map((e) => ({ x0: e.x1, x1: e.x2 }))),
  }
}

/** Indexes of the items whose buckets touch the world range `[x0, x1]`, each once. */
export function inRange(buckets: number[][], x0: number, x1: number): number[] {
  const a = Math.max(0, Math.floor(x0 / SPACING.bucket))
  const b = Math.min(buckets.length - 1, Math.floor(x1 / SPACING.bucket))
  if (a === b) return buckets[a] ?? []
  const seen = new Set<number>()
  for (let k = a; k <= b; k++) for (const i of buckets[k] as number[]) seen.add(i)
  return [...seen]
}
