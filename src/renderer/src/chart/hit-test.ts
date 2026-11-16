import { inRange, type EdgePath, type Layout, type Placed } from './layout'

/** Hit testing (docs/technical-design.md section 6). Pure; world coordinates in. */

/** The node under a world point, topmost drawn last. */
export function nodeAt(layout: Layout, x: number, y: number): Placed | null {
  let hit: Placed | null = null
  for (const i of inRange(layout.nodeBuckets, x, x)) {
    const n = layout.nodes[i] as Placed
    if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) hit = n
  }
  return hit
}

/** The curve an edge is drawn along: out of the source's right side, into the target's left. */
export function edgeControls(e: EdgePath): { c1x: number; c2x: number } {
  const reach = Math.max(18, Math.abs(e.x2 - e.x1) / 2)
  return { c1x: e.x1 + reach, c2x: e.x2 - reach }
}

function bezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const SEGMENTS = 14

export function distanceToEdge(e: EdgePath, x: number, y: number): number {
  const { c1x, c2x } = edgeControls(e)
  let best = Infinity
  let ax = e.x1
  let ay = e.y1
  for (let i = 1; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS
    const bx = bezier(e.x1, c1x, c2x, e.x2, t)
    const by = bezier(e.y1, e.y1, e.y2, e.y2, t)
    best = Math.min(best, distanceToSegment(x, y, ax, ay, bx, by))
    ax = bx
    ay = by
  }
  return best
}

/** The edge nearest a world point, within `tolerance` world pixels. */
export function edgeAt(layout: Layout, x: number, y: number, tolerance: number): EdgePath | null {
  let hit: EdgePath | null = null
  let best = tolerance
  for (const i of inRange(layout.edgeBuckets, x - tolerance, x + tolerance)) {
    const e = layout.edges[i] as EdgePath
    if (y < Math.min(e.y1, e.y2) - tolerance || y > Math.max(e.y1, e.y2) + tolerance) continue
    const d = distanceToEdge(e, x, y)
    if (d <= best) {
      best = d
      hit = e
    }
  }
  return hit
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/**
 * Keyboard movement: left and right move along a run, up and down move between
 * bands (to the nearest node by x in the next band that has one).
 */
export function neighbour(layout: Layout, fromId: string | null, direction: Direction): Placed | null {
  const from = fromId === null ? undefined : layout.byId.get(fromId)
  if (!from) return layout.nodes[0] ?? null

  if (direction === 'left' || direction === 'right') {
    const run = layout.nodes.filter((n) => n.node.agentId === from.node.agentId && n.node.run === from.node.run)
    const i = run.indexOf(from)
    return run[direction === 'right' ? i + 1 : i - 1] ?? null
  }

  const step = direction === 'down' ? 1 : -1
  const bands = [...new Set(layout.nodes.map((n) => n.band))].sort((a, b) => a - b)
  const centre = from.x + from.w / 2
  for (let at = bands.indexOf(from.band) + step; at >= 0 && at < bands.length; at += step) {
    let best: Placed | null = null
    for (const n of layout.nodes) {
      if (n.band !== bands[at]) continue
      if (!best || Math.abs(n.x + n.w / 2 - centre) < Math.abs(best.x + best.w / 2 - centre)) best = n
    }
    if (best) return best
  }
  return null
}
