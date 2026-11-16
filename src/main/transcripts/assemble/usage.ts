import type { Usage } from '../../../shared/session.js'
import type { AssistantRecord, Block, TranscriptRecord, Usage as RawUsage } from '../records.js'
import { toMs } from './types.js'

/** One reply from Anthropic: its `assistant` records, merged by `message.id`. */
export interface Reply {
  messageId: string
  /** The `api-request.id` it answers. Absent on a `<synthetic>` reply. */
  requestRef: string | undefined
  model: string
  /** In file order. */
  records: AssistantRecord[]
  content: Block[]
  usage: Usage
  stopReason: string | null
  firstAt: number
  lastAt: number
  isApiError: boolean
}

export const SYNTHETIC_MODEL = '<synthetic>'

export function toUsage(raw: RawUsage | undefined): Usage {
  if (!raw) return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
  const split = raw.cache_creation
  // Without the split, the whole write is counted at the 5-minute rate.
  const unsplit = typeof raw.cache_creation_input_tokens === 'number' ? raw.cache_creation_input_tokens : 0
  return {
    input: raw.input_tokens,
    output: raw.output_tokens,
    cacheRead: raw.cache_read_input_tokens,
    cacheWrite5m: split ? split.ephemeral_5m_input_tokens : unsplit,
    cacheWrite1h: split ? split.ephemeral_1h_input_tokens : 0,
  }
}

/**
 * Group a file's `assistant` records into replies (section 1.4). Each line of a
 * reply carries token numbers for the whole reply, and later lines can be
 * higher, so the reply's usage is its last line's: counted once.
 */
export function collectReplies(records: readonly TranscriptRecord[]): Reply[] {
  const byId = new Map<string, Reply>()
  for (const r of records) {
    if (r.type !== 'assistant') continue
    const at = toMs(r.timestamp)
    const reply = byId.get(r.message.id)
    if (!reply) {
      byId.set(r.message.id, {
        messageId: r.message.id,
        requestRef: r.requestRef,
        model: r.message.model,
        records: [r],
        content: [...r.message.content],
        usage: toUsage(r.message.usage),
        stopReason: r.message.stop_reason ?? null,
        firstAt: at,
        lastAt: at,
        isApiError: r.isApiErrorMessage === true,
      })
      continue
    }
    reply.records.push(r)
    reply.content.push(...r.message.content)
    if (r.message.usage) reply.usage = toUsage(r.message.usage)
    reply.stopReason = r.message.stop_reason ?? reply.stopReason
    reply.requestRef ??= r.requestRef
    reply.lastAt = Math.max(reply.lastAt, at)
    reply.isApiError ||= r.isApiErrorMessage === true
  }
  return [...byId.values()]
}

export function isSynthetic(reply: Reply): boolean {
  return reply.requestRef === undefined || reply.model === SYNTHETIC_MODEL
}
