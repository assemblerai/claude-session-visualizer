import type { Usage } from '../../shared/session.js'

/** US dollars per million tokens. */
export interface Rates {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

/** A 5-minute cache write costs 1.25x input, a 1-hour write 2x. */
function rates(input: number, output: number, cacheRead: number): Rates {
  return { input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 }
}

/**
 * Anthropic's first-party rates, as of 2026-11. Input and output are the
 * published list prices. The cache rates were checked against Claude Code's own
 * `cost-state.modelUsage[model].costUSD` on real sessions (docs/technical-design.md
 * section 8): with these, our cost for a model's tokens equals Claude Code's.
 *
 * Haiku 5.5 costs more above 100K prompt tokens; that tier is not modelled.
 */
export const PRICES: Readonly<Record<string, Rates>> = {
  'claude-opus-5-5': rates(4, 20, 0.2),
  'claude-sonnet-5-5': rates(2, 10, 0.1),
  'claude-haiku-5-5': rates(0.1, 0.5, 0.01),
  'claude-fable-5-1': rates(10, 50, 0.25),
  'claude-fable-5-2': rates(8, 40, 0.2),
}

/** The cost of one model's tokens, or `null` for a model with no known price. */
export function costOf(usage: Usage, model: string): number | null {
  const r = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined
  if (!r) return null
  return (
    (usage.input * r.input +
      usage.output * r.output +
      usage.cacheRead * r.cacheRead +
      usage.cacheWrite5m * r.cacheWrite5m +
      usage.cacheWrite1h * r.cacheWrite1h) /
    1_000_000
  )
}

/** Adds costs, keeping "no price" contagious: a sum with an unknown part is unknown. */
export function addCost(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b
}
