import { describe, expect, it } from 'vitest'
import { detailFor, fitText } from './lod'
import { clampScale, fitRect, MAX_SCALE, toWorld, zoomAbout } from './view'

describe('detailFor', () => {
  it.each([
    [2, 'shape'],
    [11.9, 'shape'],
    [12, 'icon'],
    [55, 'icon'],
    [56, 'label'],
    [103, 'label'],
    [104, 'badges'],
    [400, 'badges'],
  ] as const)('a node %d px wide on screen shows %s', (width, detail) => {
    expect(detailFor(width)).toBe(detail)
  })
})

describe('fitText', () => {
  const measure = (text: string): number => text.length * 10

  it.each([
    ['short', 100, 'short'],
    ['a longer label', 60, 'a lon…'],
    ['anything', 5, ''],
    ['anything', 0, ''],
  ])('fits %j into %d px', (text, width, expected) => {
    expect(fitText(text, width, measure)).toBe(expected)
  })
})

describe('view', () => {
  it('zooms about the pointer: the world point under it stays put', () => {
    const view = { scale: 0.5, tx: 40, ty: -20 }
    const before = toWorld(view, 300, 200)
    const after = toWorld(zoomAbout(view, 300, 200, 1.7), 300, 200)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('never zooms past its limits', () => {
    expect(zoomAbout({ scale: 2.9, tx: 0, ty: 0 }, 0, 0, 10).scale).toBe(MAX_SCALE)
    expect(clampScale(0)).toBeGreaterThan(0)
  })

  it('fits a rectangle whole and centred', () => {
    const view = fitRect({ x: 100, y: 50, w: 2000, h: 400 }, 1000, 600, 0)

    expect(view.scale).toBeCloseTo(0.5)
    expect(100 * view.scale + view.tx).toBeCloseTo(0)
    expect((50 + 200) * view.scale + view.ty).toBeCloseTo(300)
  })
})
