import { useEffect, useMemo, useRef } from 'react'
import { draw } from './draw'
import type { Layout } from './layout'
import { fitRect, type View } from './view'

interface MinimapProps {
  layout: Layout
  /** The main chart's camera, and the size of its canvas. */
  view: View
  viewport: { width: number; height: number }
  /** Centre the main chart on a world point. */
  onJump: (worldX: number, worldY: number) => void
}

const WIDTH = 220
const HEIGHT = 110

/** The whole session in a corner, with a rectangle for where you are. Drag the rectangle to jump around. */
export function Minimap({ layout, view, viewport, onJump }: MinimapProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const mini = useMemo(() => fitRect({ x: 0, y: 0, w: layout.width, h: layout.height }, WIDTH, HEIGHT, 4), [layout])

  // The session is drawn once per layout; only the rectangle moves.
  const backdrop = useMemo(() => {
    const off = document.createElement('canvas')
    off.width = WIDTH
    off.height = HEIGHT
    const ctx = off.getContext('2d')
    if (ctx) draw(ctx, layout, mini, WIDTH, HEIGHT, { detail: 'shape' })
    return off
  }, [layout, mini])

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const dpr = window.devicePixelRatio || 1
    el.width = WIDTH * dpr
    el.height = HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.drawImage(backdrop, 0, 0)
    const x = (-view.tx / view.scale) * mini.scale + mini.tx
    const y = (-view.ty / view.scale) * mini.scale + mini.ty
    const w = (viewport.width / view.scale) * mini.scale
    const h = (viewport.height / view.scale) * mini.scale
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.fillRect(x, y, Math.max(3, w), Math.max(3, h))
    ctx.strokeRect(x, y, Math.max(3, w), Math.max(3, h))
  }, [backdrop, mini, view, viewport])

  const jump = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    onJump((event.clientX - box.left - mini.tx) / mini.scale, (event.clientY - box.top - mini.ty) / mini.scale)
  }

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Overview map of the whole session"
      style={{ width: WIDTH, height: HEIGHT }}
      className="absolute bottom-3 left-3 cursor-crosshair rounded border border-line-strong bg-surface shadow-lg"
      onPointerDown={(event) => {
        dragging.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        jump(event)
      }}
      onPointerMove={(event) => {
        if (dragging.current) jump(event)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
    />
  )
}
