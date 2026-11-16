/**
 * Level of detail (docs/technical-design.md section 6), by a node's width on
 * screen. Text is the main drawing cost, so this is also the main performance
 * control. Nothing is ever removed: the text appears once there is room to read it.
 */
export type Detail = 'shape' | 'icon' | 'label' | 'badges'

export const DETAIL_AT = { icon: 12, label: 56, badges: 104 } as const

export function detailFor(screenWidth: number): Detail {
  if (screenWidth < DETAIL_AT.icon) return 'shape'
  if (screenWidth < DETAIL_AT.label) return 'icon'
  if (screenWidth < DETAIL_AT.badges) return 'label'
  return 'badges'
}

/** Cut `text` to fit `maxWidth`, measuring with `measure`. Ends in an ellipsis when cut. */
export function fitText(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (maxWidth <= 0) return ''
  if (measure(text) <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) low = mid
    else high = mid - 1
  }
  return low === 0 ? '' : `${text.slice(0, low)}…`
}
