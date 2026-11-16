/** The chart's camera: world → screen is `x * scale + tx`. Pure helpers. */
export interface View {
  scale: number
  tx: number
  ty: number
}

export const MIN_SCALE = 0.0005
export const MAX_SCALE = 3

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function toWorld(view: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale }
}

/** Zoom by `factor`, keeping the world point under the pointer where it is. */
export function zoomAbout(view: View, sx: number, sy: number, factor: number): View {
  const scale = clampScale(view.scale * factor)
  const applied = scale / view.scale
  return { scale, tx: sx - (sx - view.tx) * applied, ty: sy - (sy - view.ty) * applied }
}

/** The view that shows a world rectangle whole and centred, with some padding. */
export function fitRect(rect: { x: number; y: number; w: number; h: number }, screenW: number, screenH: number, pad = 24): View {
  const w = Math.max(1, rect.w)
  const h = Math.max(1, rect.h)
  const scale = clampScale(Math.min((screenW - 2 * pad) / w, (screenH - 2 * pad) / h))
  return { scale, tx: (screenW - w * scale) / 2 - rect.x * scale, ty: (screenH - h * scale) / 2 - rect.y * scale }
}
