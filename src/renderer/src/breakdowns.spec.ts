import { describe, expect, it } from 'vitest'
import { totalTokens } from '@shared/session'
import { byAgent, byFile, bySkill, byTool } from './breakdowns'
import { loadGraph } from './chart/fixtures'
import { formatCost, formatCount, formatDuration } from './format'

const graph = loadGraph('nested')

describe('breakdowns', () => {
  it('adds up to the session totals by agent', () => {
    const rows = byAgent(graph)

    expect(rows.map((r) => r.key).sort()).toEqual(graph.agents.map((a) => a.id).sort())
    expect(rows.reduce((n, r) => n + totalTokens(r.usage), 0)).toBe(totalTokens(graph.totals.usage))
    expect(rows.reduce((n, r) => n + (r.costUsd ?? 0), 0)).toBeCloseTo(graph.totals.costUsd ?? -1)
  })

  it('puts requests made with no skill active in one row', () => {
    expect(bySkill(graph)).toEqual([expect.objectContaining({ label: '(no skill active)' })])
  })

  it('counts every tool use once', () => {
    expect(byTool(graph).reduce((n, r) => n + r.uses, 0)).toBe(graph.totals.toolUses)
  })

  it('lists the files touched, changed files first, with who touched them', () => {
    const rows = byFile(graph)
    const touches = graph.nodes.filter((n) => n.tool?.file)

    expect(rows.reduce((n, r) => n + r.touches.length, 0)).toBe(touches.length)
    expect(rows[0]?.counts.write).toBeGreaterThan(0)
    expect(rows.every((r) => r.agentIds.length > 0)).toBe(true)
  })
})

describe('format', () => {
  it.each([
    [450, '450ms'],
    [3_200, '3.2s'],
    [42_000, '42s'],
    [125_000, '2m 5s'],
    [7_500_000, '2h 5m'],
  ])('writes %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })

  it('writes "no price", never zero, for an unknown cost', () => {
    expect(formatCost(null)).toBe('no price')
    expect(formatCost(0.004)).toBe('$0.0040')
    expect(formatCost(12.345)).toBe('$12.35')
  })

  it('shortens large counts', () => {
    expect([formatCount(999), formatCount(1_500), formatCount(48_000), formatCount(2_340_000)]).toEqual([
      '999',
      '1.5k',
      '48k',
      '2.34M',
    ])
  })
})
