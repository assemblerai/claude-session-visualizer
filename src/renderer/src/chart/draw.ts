import { formatCost, formatCount, formatDuration } from '../format'
import { totalTokens } from '@shared/session'
import { edgeControls } from './hit-test'
import { inRange, SPACING, type EdgePath, type Layout, type Placed } from './layout'
import { detailFor, fitText, type Detail } from './lod'
import { branchColour, EDGE, ERROR, NODE_STYLE, SELECTED, SURFACE, TEXT, TEXT_MUTED } from './theme'
import type { View } from './view'

/**
 * Canvas drawing (docs/technical-design.md section 6). Everything is drawn in
 * screen pixels from world positions, so lines and text keep their weight at
 * any zoom. If the frame budget is ever missed, this file is the only thing
 * replaced.
 */

export interface DrawOptions {
  selectedId?: string | null
  hoverId?: string | null
  hoverEdgeId?: string | null
  /** Force one level of detail: the minimap draws shapes only. */
  detail?: Detail
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const ICON_FONT = '"Segoe UI Symbol", "Apple Symbols", system-ui, sans-serif'
const fitted = new Map<string, string>()

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string {
  const key = `${font}|${Math.round(maxWidth)}|${text}`
  const known = fitted.get(key)
  if (known !== undefined) return known
  if (fitted.size > 20_000) fitted.clear()
  const result = fitText(text, maxWidth, (t) => ctx.measureText(t).width)
  fitted.set(key, result)
  return result
}

function shape(ctx: CanvasRenderingContext2D, n: Placed, x: number, y: number, w: number, h: number): void {
  ctx.beginPath()
  switch (n.node.kind) {
    case 'prompt':
    case 'result':
      ctx.roundRect(x, y, w, h, Math.min(h, w) / 2)
      break
    case 'request': {
      // A diamond, stretched: pointed ends, flat top and bottom when there is room for text.
      const k = Math.min(h / 2, w / 2)
      ctx.moveTo(x, y + h / 2)
      ctx.lineTo(x + k, y)
      ctx.lineTo(x + w - k, y)
      ctx.lineTo(x + w, y + h / 2)
      ctx.lineTo(x + w - k, y + h)
      ctx.lineTo(x + k, y + h)
      ctx.closePath()
      break
    }
    case 'mcp-tool': {
      // A rectangle with a tab.
      const tab = Math.min(h * 0.18, 6)
      ctx.moveTo(x, y)
      ctx.lineTo(x, y - tab)
      ctx.lineTo(x + w * 0.38, y - tab)
      ctx.lineTo(x + w * 0.38, y)
      ctx.lineTo(x + w, y)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      break
    }
    case 'context': {
      // A note: one folded corner.
      const fold = Math.min(h * 0.4, w * 0.3, 8)
      ctx.moveTo(x, y)
      ctx.lineTo(x + w - fold, y)
      ctx.lineTo(x + w, y + fold)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      break
    }
    default:
      ctx.roundRect(x, y, w, h, Math.min(3, w / 2))
  }
}

function badgesOf(n: Placed): string {
  const node = n.node
  const parts = [formatDuration(node.endedAt - node.startedAt)]
  if (node.request?.hasReply) parts.push(`${formatCount(totalTokens(node.request.usage))} tok`, formatCost(node.request.costUsd))
  return parts.join(' · ')
}

function drawNode(ctx: CanvasRenderingContext2D, n: Placed, view: View, opts: DrawOptions, screenH: number): void {
  const x = n.x * view.scale + view.tx
  const y = n.y * view.scale + view.ty
  const w = Math.max(1.5, n.w * view.scale)
  const h = Math.max(1.5, n.h * view.scale)
  const style = NODE_STYLE[n.node.kind]
  const detail = opts.detail ?? detailFor(w)

  if (n.node.kind === 'compaction') {
    // A divider across the whole chart.
    ctx.save()
    ctx.strokeStyle = style.line
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, screenH)
    ctx.stroke()
    ctx.restore()
  }

  shape(ctx, n, x, y, w, h)
  ctx.fillStyle = style.fill
  ctx.fill()
  const selected = opts.selectedId === n.node.id
  ctx.lineWidth = n.node.error ? 2.5 : n.node.kind === 'agent' ? 3 : 1.25
  ctx.strokeStyle = n.node.error ? ERROR : n.node.kind === 'agent' ? branchColour(n.agentIndex) : style.line
  if (detail === 'shape') ctx.lineWidth = Math.min(ctx.lineWidth, 1)
  ctx.stroke()
  if (selected || opts.hoverId === n.node.id) {
    ctx.lineWidth = selected ? 2 : 1
    ctx.strokeStyle = SELECTED
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6)
  }
  if (detail === 'shape' || h < 9) return

  const size = Math.max(9, Math.min(13, h * 0.42, 11 * Math.max(1, view.scale)))
  const twoLines = detail === 'badges' && n.node.kind !== 'context' && h >= size * 2.5
  const inset = n.node.kind === 'request' ? Math.min(h / 2, w / 2) * 0.7 : 6
  const midY = twoLines ? y + h * 0.34 : y + h / 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  ctx.font = `${size}px ${ICON_FONT}`
  ctx.fillStyle = n.node.error ? ERROR : style.line
  const icon = n.node.error ? '!' : style.icon
  if (detail === 'icon') {
    ctx.textAlign = 'center'
    ctx.fillText(icon, x + w / 2, y + h / 2)
    return
  }
  ctx.fillText(icon, x + inset, midY)
  const iconWidth = size * 1.25

  ctx.font = `${size}px ${FONT}`
  ctx.fillStyle = TEXT
  const room = w - 2 * inset - iconWidth
  ctx.fillText(fit(ctx, n.node.label, room, ctx.font), x + inset + iconWidth, midY)
  if (!twoLines) return

  ctx.font = `${Math.max(8, size - 2)}px ${FONT}`
  ctx.fillStyle = TEXT_MUTED
  ctx.fillText(fit(ctx, badgesOf(n), w - 2 * inset, ctx.font), x + inset, y + h * 0.72)
}

function edgeWidth(bytes: number): number {
  // Thickness shows how much data moved, so the heavy flows stand out.
  return Math.min(5, 1 + Math.log10(bytes + 1) * 0.55)
}

function drawEdge(ctx: CanvasRenderingContext2D, e: EdgePath, view: View, hover: boolean): void {
  const x1 = e.x1 * view.scale + view.tx
  const y1 = e.y1 * view.scale + view.ty
  const x2 = e.x2 * view.scale + view.tx
  const y2 = e.y2 * view.scale + view.ty
  const { c1x, c2x } = edgeControls(e)
  const branch = e.edge.kind !== 'flow'

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.bezierCurveTo(c1x * view.scale + view.tx, y1, c2x * view.scale + view.tx, y2, x2, y2)
  ctx.strokeStyle = hover ? SELECTED : branch ? branchColour(e.agentIndex) : EDGE
  ctx.lineWidth = Math.max(1, edgeWidth(e.edge.bytes) * Math.min(1, view.scale * 1.4)) + (branch ? 0.75 : 0)
  ctx.setLineDash([])
  ctx.stroke()

  if (view.scale < 0.4) return
  ctx.setLineDash([])
  ctx.fillStyle = ctx.strokeStyle
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - 7, y2 - 3.5)
  ctx.lineTo(x2 - 7, y2 + 3.5)
  ctx.closePath()
  ctx.fill()
}

export function draw(ctx: CanvasRenderingContext2D, layout: Layout, view: View, width: number, height: number, opts: DrawOptions = {}): void {
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, width, height)

  const wx0 = -view.tx / view.scale
  const wx1 = (width - view.tx) / view.scale
  const wy0 = -view.ty / view.scale
  const wy1 = (height - view.ty) / view.scale
  const minimal = opts.detail === 'shape'

  // Branch lines: one colour along a run's whole length, like a git history.
  const lineY = SPACING.bandPad + SPACING.unitHeight + SPACING.unitGap / 2
  for (const band of layout.bands) {
    if (band.x0 > wx1 || band.x1 < wx0) continue
    const y = (band.y + lineY) * view.scale + view.ty
    const x1 = band.x1 * view.scale + view.tx
    ctx.strokeStyle = branchColour(band.agentIndex)
    ctx.lineWidth = minimal ? 1 : 2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(band.lineX0 * view.scale + view.tx, y)
    ctx.lineTo(band.lineX1 * view.scale + view.tx, y)
    ctx.stroke()
    if (!minimal && band.h * view.scale > 26) {
      ctx.font = `13px ${FONT}`
      ctx.fillStyle = branchColour(band.agentIndex)
      ctx.textBaseline = 'bottom'
      ctx.textAlign = 'left'
      // Starts where the branch's own first box starts, so the label lines up with it;
      // once that has scrolled off the left edge, it stays on screen until the branch ends.
      const labelX = Math.max(band.labelX * view.scale + view.tx, Math.min(8, x1 - 60))
      ctx.fillText(fit(ctx, band.label, Math.max(60, x1 - labelX), ctx.font), labelX, band.y * view.scale + view.ty - 3)
    }
  }

  // Arrows.
  const edges = inRange(layout.edgeBuckets, wx0, wx1)
  if (view.scale < 0.08 || minimal) {
    // Far out, an arrow is a hairline: one path for the lot.
    ctx.strokeStyle = EDGE
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    for (const i of edges) {
      const e = layout.edges[i] as EdgePath
      ctx.moveTo(e.x1 * view.scale + view.tx, e.y1 * view.scale + view.ty)
      ctx.lineTo(e.x2 * view.scale + view.tx, e.y2 * view.scale + view.ty)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  } else {
    for (const i of edges) {
      const e = layout.edges[i] as EdgePath
      if (Math.max(e.y1, e.y2) < wy0 || Math.min(e.y1, e.y2) > wy1) continue
      drawEdge(ctx, e, view, opts.hoverEdgeId === e.edge.id)
    }
    ctx.setLineDash([])
  }

  for (const i of inRange(layout.nodeBuckets, wx0, wx1)) {
    const n = layout.nodes[i] as Placed
    if (n.x > wx1 || n.x + n.w < wx0) continue
    if (n.node.kind !== 'compaction' && (n.y > wy1 || n.y + n.h < wy0)) continue
    drawNode(ctx, n, view, opts, height)
  }
}
