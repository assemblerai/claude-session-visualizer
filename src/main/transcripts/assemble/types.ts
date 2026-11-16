import type { AgentMeta, ParsedTranscript } from '../records.js'

/** One helper's two files, parsed. */
export interface HelperFiles {
  agentId: string
  meta: AgentMeta
  transcript: ParsedTranscript
}

/** Everything on disk for one session, parsed. The input to `assemble`. */
export interface SessionFiles {
  sessionId: string
  main: ParsedTranscript
  helpers: HelperFiles[]
}

export const MAIN_AGENT = 'main'

export function toMs(timestamp: string): number {
  const ms = Date.parse(timestamp)
  return Number.isNaN(ms) ? 0 : ms
}

/** The size of a value as it would travel: a string's bytes, or its JSON's. */
export function sizeOf(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value === 'string') return Buffer.byteLength(value)
  return Buffer.byteLength(JSON.stringify(value) ?? '')
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
