import { describe, expect, it } from 'vitest'
import { addCost, costOf } from './pricing.js'

describe('costOf', () => {
  it("matches Claude Code's own figure for the same tokens", () => {
    // The last cost-state of the nested fixture's session, before its helpers ran.
    const usage = { input: 18, output: 4276, cacheRead: 337580, cacheWrite5m: 0, cacheWrite1h: 51758 }

    expect(costOf(usage, 'claude-opus-5-5')).toBeCloseTo(0.567172, 5)
  })

  it('prices the two cache-write lifetimes differently', () => {
    const base = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }

    expect(costOf({ ...base, cacheWrite5m: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(2.5)
    expect(costOf({ ...base, cacheWrite1h: 1_000_000 }, 'claude-sonnet-5-5')).toBeCloseTo(4)
  })

  it('answers null, never zero, for a model with no price', () => {
    expect(costOf({ input: 5, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, 'claude-next-9')).toBeNull()
    expect(costOf({ input: 5, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, 'toString')).toBeNull()
  })
})

describe('addCost', () => {
  it('keeps an unknown part unknown', () => {
    expect(addCost(1, 2)).toBe(3)
    expect(addCost(1, null)).toBeNull()
  })
})
