import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Ruler, SquareDashedMousePointer } from 'lucide-react'
import type { SessionGraph } from '@shared/session'
import { formatBytes } from '../format'
import { draw } from './draw'
import { edgeAt, neighbour, nodeAt, type Direction } from './hit-test'
import { layout as computeLayout, type EdgePath, type Layout, type LayoutMode, type Placed } from './layout'
import { Minimap } from './Minimap'
import { NODE_STYLE } from './theme'
import { fitRect, toWorld, zoomAbout, type View } from './view'
import { chartGraph } from './visible'

interface ChartProps {
  graph: SessionGraph
  mode: LayoutMode
  onModeChange: (mode: LayoutMode) => void
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
  /** Enter on a selected node: move to its details. */
  onOpen: () => void
}

interface Hover {
  x: number
  y: number
  text: string
}

const KEY_DIRECTION: Readonly<Record<string, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/** Which node an arrow's data belongs to: a request's ask is the tool's input; anything else is its source's output. */
function nodeOfEdge(edge: EdgePath, layout: Layout): string {
  const from = layout.byId.get(edge.edge.from)
  if (edge.edge.kind === 'spawn') return edge.edge.to
  if (edge.edge.kind === 'join' && from) return `agent:${from.node.agentId}:${from.node.run}`
  return from?.node.kind === 'request' && edge.edge.direction === 'in' ? edge.edge.to : edge.edge.from
}

function describe(n: Placed): string {
  return `${NODE_STYLE[n.node.kind].name}: ${n.node.label}${n.node.error ? ', failed' : ''}`
}

/**
 * The process chart: one canvas, one focusable element. Wheel zooms about the
 * pointer, drag pans, Shift-drag (or the area tool) zooms to a box, and
 * double-click fits a branch. Only what is on screen is drawn.
 */
export function Chart({ graph, mode, onModeChange, selectedId, onSelect, onOpen }: ChartProps): React.JSX.Element {
  const layout = useMemo(() => computeLayout(chartGraph(graph), mode), [graph, mode])
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  const [areaTool, setAreaTool] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const hoverIds = useRef<{ node: string | null; edge: string | null }>({ node: null, edge: null })
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; box: boolean } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  const fitAll = useCallback((): void => {
    if (size.width > 0) setView(fitRect({ x: 0, y: 0, w: layout.width, h: layout.height }, size.width, size.height))
  }, [layout, size])

  // Fit when a session opens or the mode changes; a live session growing keeps the camera where it is.
  const fittedFor = useRef('')
  useEffect(() => {
    const key = `${graph.sessionId}|${mode}`
    if (size.width === 0 || fittedFor.current === key) return
    fittedFor.current = key
    // Open on the start of the session at a readable size, not on a speck.
    const whole = fitRect({ x: 0, y: 0, w: layout.width, h: layout.height }, size.width, size.height)
    setView(whole.scale >= 0.35 ? whole : { scale: 0.6, tx: 8, ty: 56 })
  }, [graph.sessionId, mode, layout, size])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(size.width * dpr) || el.height !== Math.round(size.height * dpr)) {
      el.width = Math.round(size.width * dpr)
      el.height = Math.round(size.height * dpr)
    }
    const frame = requestAnimationFrame(() => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, layout, view, size.width, size.height, {
        selectedId,
        hoverId: hoverIds.current.node,
        hoverEdgeId: hoverIds.current.edge,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [layout, view, size, selectedId, hover])

  // Wheel must be able to stop the page scrolling, which React's passive listener cannot.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      setView((v) =>
        zoomAbout(v, event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015)),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const local = (event: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const hit = (sx: number, sy: number): { node: Placed | null; edge: EdgePath | null } => {
    const world = toWorld(view, sx, sy)
    const node = nodeAt(layout, world.x, world.y)
    return { node, edge: node ? null : edgeAt(layout, world.x, world.y, 5 / view.scale) }
  }

  const fitRun = (agentId: string, run: number): void => {
    const band = layout.bands.find((b) => b.agentId === agentId && b.run === run)
    if (band) setView(fitRect({ x: band.x0, y: band.y, w: band.x1 - band.x0, h: band.h }, size.width, size.height, 40))
  }

  const reveal = (n: Placed): void => {
    const sx = n.x * view.scale + view.tx
    const sy = n.y * view.scale + view.ty
    const inside =
      sx >= 20 && sy >= 20 && sx + n.w * view.scale <= size.width - 20 && sy + n.h * view.scale <= size.height - 20
    if (!inside)
      setView({
        ...view,
        tx: size.width / 2 - (n.x + n.w / 2) * view.scale,
        ty: size.height / 2 - (n.y + n.h / 2) * view.scale,
      })
  }

  const selected = selectedId === null ? undefined : layout.byId.get(selectedId)

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvas}
        role="application"
        tabIndex={0}
        aria-label="Process chart. Arrow keys move between steps, Enter opens the details."
        style={{
          width: size.width,
          height: size.height,
          cursor: areaTool ? 'crosshair' : hover ? 'pointer' : 'grab',
        }}
        className="block outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onPointerDown={(event) => {
          const p = local(event)
          drag.current = { ...p, view, moved: false, box: areaTool || event.shiftKey }
          // No tooltip while dragging; the next move after release re-hits.
          hoverIds.current = { node: null, edge: null }
          setHover(null)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const p = local(event)
          const d = drag.current
          if (d) {
            if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true
            if (!d.moved) return
            if (d.box) setBox({ x0: d.x, y0: d.y, x1: p.x, y1: p.y })
            else setView({ ...d.view, tx: d.view.tx + p.x - d.x, ty: d.view.ty + p.y - d.y })
            return
          }
          const { node, edge } = hit(p.x, p.y)
          const ids = { node: node?.node.id ?? null, edge: edge?.edge.id ?? null }
          if (ids.node === hoverIds.current.node && ids.edge === hoverIds.current.edge) return
          hoverIds.current = ids
          setHover(
            node
              ? { ...p, text: describe(node) }
              : edge
                ? { ...p, text: `${edge.edge.label || edge.edge.kind}, ${formatBytes(edge.edge.bytes)}` }
                : null,
          )
        }}
        onPointerUp={(event) => {
          const d = drag.current
          drag.current = null
          if (!d) return
          const p = local(event)
          if (d.box && d.moved) {
            const a = toWorld(view, Math.min(d.x, p.x), Math.min(d.y, p.y))
            const b = toWorld(view, Math.max(d.x, p.x), Math.max(d.y, p.y))
            setBox(null)
            setAreaTool(false)
            if (b.x - a.x > 4)
              setView(fitRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, size.width, size.height, 8))
            return
          }
          if (d.moved) return
          const { node, edge } = hit(p.x, p.y)
          onSelect(node ? node.node.id : edge ? nodeOfEdge(edge, layout) : null)
        }}
        onPointerLeave={() => {
          hoverIds.current = { node: null, edge: null }
          setHover(null)
        }}
        onDoubleClick={(event) => {
          const p = local(event)
          const node = hit(p.x, p.y).node
          if (node) fitRun(node.node.agentId, node.node.run)
        }}
        onKeyDown={(event) => {
          const direction = KEY_DIRECTION[event.key]
          if (direction) {
            event.preventDefault()
            const next = neighbour(layout, selectedId, direction)
            if (next) {
              onSelect(next.node.id)
              reveal(next)
            }
          } else if (event.key === 'Enter' && selectedId) onOpen()
          else if (event.key === 'Escape') onSelect(null)
          else if (event.key === '0' || event.key === 'f') fitAll()
          else if (event.key === '+' || event.key === '=' || event.key === '-') {
            // Zoom about the selected step when it is on screen, else about the middle.
            const sx = selected ? (selected.x + selected.w / 2) * view.scale + view.tx : size.width / 2
            const sy = selected ? (selected.y + selected.h / 2) * view.scale + view.ty : size.height / 2
            const onScreen = sx >= 0 && sx <= size.width && sy >= 0 && sy <= size.height
            setView((v) =>
              zoomAbout(
                v,
                onScreen ? sx : size.width / 2,
                onScreen ? sy : size.height / 2,
                event.key === '-' ? 0.8 : 1.25,
              ),
            )
          }
        }}
      />

      {box && (
        <div
          className="pointer-events-none absolute border border-primary bg-primary/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-80 truncate rounded bg-surface-overlay px-2 py-1 text-xs text-on-surface shadow"
          style={{ left: Math.min(hover.x + 12, size.width - 200), top: hover.y + 14 }}
        >
          {hover.text}
        </div>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-1 rounded border border-line-control bg-surface-raised p-1 text-xs shadow">
        <button
          type="button"
          onClick={fitAll}
          title="Fit all (0)"
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-overlay"
        >
          <Maximize2 aria-hidden className="size-3.5" /> Fit all
        </button>
        <button
          type="button"
          aria-pressed={areaTool}
          onClick={() => setAreaTool((on) => !on)}
          title="Drag a box to zoom into it (or hold Shift and drag)"
          className={`flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-overlay ${areaTool ? 'bg-surface-overlay text-primary' : ''}`}
        >
          <SquareDashedMousePointer aria-hidden className="size-3.5" /> Zoom to area
        </button>
        <button
          type="button"
          aria-pressed={mode === 'scale'}
          onClick={() => onModeChange(mode === 'scale' ? 'ordered' : 'scale')}
          title="Space steps by how long they took"
          className={`flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-overlay ${mode === 'scale' ? 'bg-surface-overlay text-primary' : ''}`}
        >
          <Ruler aria-hidden className="size-3.5" /> To scale
        </button>
        <span className="px-2 text-muted">
          {view.scale >= 0.1 ? Math.round(view.scale * 100) : (view.scale * 100).toFixed(1)}%
        </span>
      </div>

      <Legend />
      {size.width > 0 && (
        <Minimap
          layout={layout}
          view={view}
          viewport={size}
          onJump={(x, y) =>
            setView((v) => ({ ...v, tx: size.width / 2 - x * v.scale, ty: size.height / 2 - y * v.scale }))
          }
        />
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {selected ? describe(selected) : ''}
      </div>
    </div>
  )
}

function Legend(): React.JSX.Element {
  return (
    <details className="absolute right-3 top-3 rounded border border-line-control bg-surface-raised text-xs shadow">
      <summary className="px-2 py-1 text-muted">Legend</summary>
      <ul className="flex flex-col gap-1 px-2 pb-2">
        {Object.values(NODE_STYLE).map((style) => (
          <li key={style.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex size-4 items-center justify-center rounded-sm border text-[10px]"
              style={{ background: style.fill, borderColor: style.line, color: style.line }}
            >
              {style.icon}
            </span>
            {style.name}
          </li>
        ))}
        <li className="mt-1 text-muted">Solid arrow: data going in</li>
        <li className="text-muted">Dashed arrow: a result coming back</li>
        <li className="text-muted">Red outline: the step failed</li>
      </ul>
    </details>
  )
}
