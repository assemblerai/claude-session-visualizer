import { z } from 'zod'

/**
 * The session files, as typed records (docs/technical-design.md section 1.2).
 *
 * A schema names only the fields the app uses and lets the rest through, so a
 * new field in a Claude Code release is not a failure. A new record *kind* is
 * counted in `ParseCounts.unknownKinds`, and a line that is not a record of its
 * claimed kind is counted in `invalidLines`; neither is dropped silently.
 */

// ---- content blocks --------------------------------------------------------

const textBlock = z.looseObject({ type: z.literal('text'), text: z.string() })
const thinkingBlock = z.looseObject({ type: z.literal('thinking'), thinking: z.string() })
const toolUseBlock = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
})
const toolResultBlock = z.looseObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
})
/** Any other block (image, tool_reference, ...): kept, and shown as JSON. */
const otherBlock = z.looseObject({ type: z.string() })

const block = z.union([textBlock, thinkingBlock, toolUseBlock, toolResultBlock, otherBlock])

export type TextBlock = z.infer<typeof textBlock>
export type ThinkingBlock = z.infer<typeof thinkingBlock>
export type ToolUseBlock = z.infer<typeof toolUseBlock>
export type ToolResultBlock = z.infer<typeof toolResultBlock>
export type Block = z.infer<typeof block>

export const isText = (b: Block): b is TextBlock => b.type === 'text' && typeof b.text === 'string'
export const isThinking = (b: Block): b is ThinkingBlock => b.type === 'thinking' && typeof b.thinking === 'string'
export const isToolUse = (b: Block): b is ToolUseBlock => b.type === 'tool_use' && typeof b.id === 'string'
export const isToolResult = (b: Block): b is ToolResultBlock =>
  b.type === 'tool_result' && typeof b.tool_use_id === 'string'

// ---- conversation records --------------------------------------------------

const envelope = {
  uuid: z.string(),
  parentUuid: z.string().nullable().optional(),
  timestamp: z.string(),
  sessionId: z.string().optional(),
  /** Present in a helper's file; equals the id in the file name. */
  agentId: z.string().optional(),
}

const origin = z.looseObject({ kind: z.string(), from: z.string().optional(), handback: z.boolean().optional() })

const userRecord = z.looseObject({
  type: z.literal('user'),
  ...envelope,
  message: z.looseObject({ role: z.literal('user'), content: z.union([z.string(), z.array(block)]) }),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  origin: origin.optional(),
  sourceToolAssistantUUID: z.string().optional(),
  toolUseResult: z.unknown().optional(),
})

const usage = z.looseObject({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
  cache_creation: z
    .looseObject({
      ephemeral_5m_input_tokens: z.number().default(0),
      ephemeral_1h_input_tokens: z.number().default(0),
    })
    .optional(),
})

const assistantRecord = z.looseObject({
  type: z.literal('assistant'),
  ...envelope,
  message: z.looseObject({
    id: z.string(),
    role: z.literal('assistant'),
    model: z.string(),
    content: z.array(block),
    stop_reason: z.string().nullable().optional(),
    usage: usage.optional(),
  }),
  /** The `api-request.id` this reply answers. Absent on a `<synthetic>` reply. */
  requestRef: z.string().optional(),
  attributionSkill: z.string().optional(),
  isApiErrorMessage: z.boolean().optional(),
})

const attachmentRecord = z.looseObject({
  type: z.literal('attachment'),
  ...envelope,
  attachment: z.looseObject({ type: z.string(), origin: origin.optional() }),
  rendered: z.unknown().optional(),
})

const systemRecord = z.looseObject({
  type: z.literal('system'),
  ...envelope,
  subtype: z.string().optional(),
  durationMs: z.number().optional(),
})

// ---- request records -------------------------------------------------------

const apiRequestRecord = z.looseObject({
  type: z.literal('api-request'),
  id: z.string(),
  timestamp: z.string(),
  agentId: z.string().optional(),
  querySource: z.string().optional(),
  shapeHash: z.string().optional(),
  params: z.looseObject({ model: z.string().optional() }).default({}),
  /** The request this one extends. Absent on the first request of a chain. */
  base: z.string().optional(),
  keep: z.number().default(0),
  tail: z.array(z.string()).default([]),
})

const apiRequestShapeRecord = z.looseObject({
  type: z.literal('api-request-shape'),
  shapeHash: z.string(),
  shape: z.looseObject({
    system: z.array(z.unknown()).default([]),
    tools: z.array(z.looseObject({ name: z.string() })).default([]),
  }),
})

const apiRequestBlobRecord = z.looseObject({
  type: z.literal('api-request-blob'),
  hash: z.string(),
  message: z.looseObject({ role: z.string(), content: z.unknown() }),
})

// ---- session-level records -------------------------------------------------

const modelUsage = z.looseObject({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
  /** Both lifetimes together. Often the only cache-write figure recorded. */
  cacheCreationInputTokens: z.number().default(0),
  cacheCreationEphemeral5mInputTokens: z.number().default(0),
  cacheCreationEphemeral1hInputTokens: z.number().default(0),
  costUSD: z.number().default(0),
})

const costStateRecord = z.looseObject({
  type: z.literal('cost-state'),
  totalCostUSD: z.number().default(0),
  totalDuration: z.number().default(0),
  totalAPIDuration: z.number().default(0),
  totalToolDuration: z.number().default(0),
  modelUsage: z.record(z.string(), modelUsage).default({}),
})

const aiTitleRecord = z.looseObject({ type: z.literal('ai-title'), aiTitle: z.string() })

const SCHEMAS = {
  user: userRecord,
  assistant: assistantRecord,
  attachment: attachmentRecord,
  system: systemRecord,
  'api-request': apiRequestRecord,
  'api-request-shape': apiRequestShapeRecord,
  'api-request-blob': apiRequestBlobRecord,
  'cost-state': costStateRecord,
  'ai-title': aiTitleRecord,
} as const

export type UserRecord = z.infer<typeof userRecord>
export type AssistantRecord = z.infer<typeof assistantRecord>
export type AttachmentRecord = z.infer<typeof attachmentRecord>
export type SystemRecord = z.infer<typeof systemRecord>
export type ApiRequestRecord = z.infer<typeof apiRequestRecord>
export type ApiRequestShapeRecord = z.infer<typeof apiRequestShapeRecord>
export type ApiRequestBlobRecord = z.infer<typeof apiRequestBlobRecord>
export type CostStateRecord = z.infer<typeof costStateRecord>
export type AiTitleRecord = z.infer<typeof aiTitleRecord>
export type Usage = z.infer<typeof usage>

export type TranscriptRecord =
  | UserRecord
  | AssistantRecord
  | AttachmentRecord
  | SystemRecord
  | ApiRequestRecord
  | ApiRequestShapeRecord
  | ApiRequestBlobRecord
  | CostStateRecord
  | AiTitleRecord

/** Kinds the app reads past on purpose. Still counted, so a new kind stands out. */
export const IGNORED_KINDS: ReadonlySet<string> = new Set([
  'session-owner',
  'atis-latch',
  'bridge-session',
  'frame-link',
  'agent-setting',
  'agent-name',
  'tools-used',
  'last-prompt',
  'mode',
  'permission-mode',
  'queue-operation',
  'continued-in',
  'file-history-snapshot',
  'file-history-delta',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
])

export interface ParseCounts {
  /** Records of a kind the app has never seen, by kind. */
  unknownKinds: Record<string, number>
  /** Records of a kind the app ignores on purpose, by kind. */
  ignoredKinds: Record<string, number>
  /** Lines that are not JSON, have no `type`, or do not fit their kind's schema. */
  invalidLines: number
}

export interface ParsedTranscript {
  /** In file order. */
  records: TranscriptRecord[]
  counts: ParseCounts
}

export type ParsedLine =
  | { outcome: 'record'; record: TranscriptRecord }
  | { outcome: 'ignored'; kind: string }
  | { outcome: 'unknown'; kind: string }
  | { outcome: 'invalid' }

function isKnownKind(kind: string): kind is keyof typeof SCHEMAS {
  return Object.hasOwn(SCHEMAS, kind)
}

export function parseLine(line: string): ParsedLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { outcome: 'invalid' }
  }
  if (typeof value !== 'object' || value === null) return { outcome: 'invalid' }
  const kind = (value as { type?: unknown }).type
  if (typeof kind !== 'string') return { outcome: 'invalid' }
  if (IGNORED_KINDS.has(kind)) return { outcome: 'ignored', kind }
  if (!isKnownKind(kind)) return { outcome: 'unknown', kind }
  const parsed = SCHEMAS[kind].safeParse(value)
  return parsed.success ? { outcome: 'record', record: parsed.data } : { outcome: 'invalid' }
}

/** Parse a whole `.jsonl` file's text. Blank lines are skipped. */
export function parseTranscript(text: string): ParsedTranscript {
  const records: TranscriptRecord[] = []
  const counts: ParseCounts = { unknownKinds: {}, ignoredKinds: {}, invalidLines: 0 }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const parsed = parseLine(line)
    if (parsed.outcome === 'record') records.push(parsed.record)
    else if (parsed.outcome === 'ignored')
      counts.ignoredKinds[parsed.kind] = (counts.ignoredKinds[parsed.kind] ?? 0) + 1
    else if (parsed.outcome === 'unknown')
      counts.unknownKinds[parsed.kind] = (counts.unknownKinds[parsed.kind] ?? 0) + 1
    else counts.invalidLines += 1
  }
  return { records, counts }
}

// ---- agent-<id>.meta.json --------------------------------------------------

const agentMeta = z.looseObject({
  agentType: z.string(),
  description: z.string().default(''),
  /** The parent's `tool_use.id` that started this helper. */
  toolUseId: z.string(),
  /** Absent when the parent is the main agent. */
  parentAgentId: z.string().optional(),
  spawnDepth: z.number().default(1),
  requestShape: z.string().default('foreground'),
  finished: z.boolean().default(false),
})

export type AgentMeta = z.infer<typeof agentMeta>

/** Parse a helper's label file. `null` when it is not one. */
export function parseAgentMeta(text: string): AgentMeta | null {
  try {
    const parsed = agentMeta.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
