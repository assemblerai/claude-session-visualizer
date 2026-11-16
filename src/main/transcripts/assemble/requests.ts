import { createHash } from 'node:crypto'
import {
  isToolResult,
  type ApiRequestRecord,
  type ApiRequestShapeRecord,
  type AssistantRecord,
  type Block,
  type TranscriptRecord,
  type UserRecord,
} from '../records.js'

/**
 * Rebuilding what a request sent (docs/technical-design.md section 1.3).
 */

export interface Message {
  role: string
  content: unknown
}

/** JSON with keys sorted, no whitespace and non-ASCII left unescaped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const parts: string[] = []
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  }
  return `{${parts.join(',')}}`
}

export function fingerprint(message: Message): string {
  return createHash('sha256').update(canonicalJson(message), 'utf8').digest('hex')
}

type Conversation = UserRecord | AssistantRecord

function hasToolResult(record: Conversation): boolean {
  const content = record.message.content
  return record.type === 'user' && Array.isArray(content) && content.some(isToolResult)
}

/**
 * Every message the transcript's own records can stand in for: the four
 * candidates, in the order the design lists them.
 */
export function* transcriptMessages(records: readonly TranscriptRecord[]): Generator<Message> {
  const conversation = records.filter((r): r is Conversation => r.type === 'user' || r.type === 'assistant')

  // 1. one record's {role, content}
  for (const r of conversation) yield { role: r.message.role, content: r.message.content }

  // 2. one reply's assistant records merged by message.id
  const replies = new Map<string, Block[][]>()
  for (const r of conversation) {
    if (r.type !== 'assistant') continue
    const parts = replies.get(r.message.id)
    if (parts) parts.push(r.message.content)
    else replies.set(r.message.id, [r.message.content])
  }
  for (const parts of replies.values()) if (parts.length > 1) yield { role: 'assistant', content: parts.flat() }

  // 3. a run of consecutive tool-result records, merged
  let run: Conversation[] = []
  for (const r of [...conversation, null]) {
    if (r !== null && hasToolResult(r)) {
      run.push(r)
      continue
    }
    if (run.length > 1) yield { role: 'user', content: run.flatMap((x) => x.message.content as Block[]) }
    run = []
  }

  // 4. a prompt whose content is a string, rewritten as one text block
  for (const r of conversation) {
    if (r.type === 'user' && typeof r.message.content === 'string') {
      yield { role: 'user', content: [{ type: 'text', text: r.message.content }] }
    }
  }
}

export type RequestShape = ApiRequestShapeRecord['shape']

export interface RequestIndex {
  /** In file order. */
  requests: readonly ApiRequestRecord[]
  byId: ReadonlyMap<string, ApiRequestRecord>
  /** The request's full list of fingerprints, by following base / keep / tail. */
  fingerprints(requestId: string): string[]
  /** How many of the request's leading messages were carried over from its base. */
  kept(requestId: string): number
  /** The message behind a fingerprint; `undefined` when its content was not recorded. */
  resolve(hash: string): Message | undefined
  shape(shapeHash: string | undefined): RequestShape | undefined
  /** Distinct fingerprints some request lists that nothing resolves. */
  unresolved: readonly string[]
}

/** Index one file's request records. `base` never crosses files, so one index per agent. */
export function indexRequests(records: readonly TranscriptRecord[]): RequestIndex {
  const requests: ApiRequestRecord[] = []
  const byId = new Map<string, ApiRequestRecord>()
  const shapes = new Map<string, RequestShape>()
  const lookup = new Map<string, Message>()

  for (const r of records) {
    if (r.type === 'api-request') {
      requests.push(r)
      byId.set(r.id, r)
    } else if (r.type === 'api-request-shape') shapes.set(r.shapeHash, r.shape)
    else if (r.type === 'api-request-blob') lookup.set(r.hash, r.message)
  }

  // Blobs first. Hashing the transcript is the expensive part, so it is done
  // only when some request lists a fingerprint no blob answers.
  const wanted = new Set<string>()
  for (const r of requests) for (const h of r.tail) wanted.add(h)
  let missing = [...wanted].filter((h) => !lookup.has(h))
  if (missing.length > 0) {
    for (const message of transcriptMessages(records)) {
      const hash = fingerprint(message)
      if (!lookup.has(hash)) lookup.set(hash, message)
    }
    missing = missing.filter((h) => !lookup.has(h))
  }

  function fingerprints(requestId: string): string[] {
    const chain: ApiRequestRecord[] = []
    const seen = new Set<string>()
    let current = byId.get(requestId)
    while (current && !seen.has(current.id)) {
      chain.push(current)
      seen.add(current.id)
      current = current.base === undefined ? undefined : byId.get(current.base)
    }
    let list: string[] = []
    for (let i = chain.length - 1; i >= 0; i--) {
      const r = chain[i]!
      list = r.base !== undefined && byId.has(r.base) ? list.slice(0, r.keep).concat(r.tail) : [...r.tail]
    }
    return list
  }

  return {
    requests,
    byId,
    fingerprints,
    kept(requestId) {
      const r = byId.get(requestId)
      if (r?.base === undefined || !byId.has(r.base)) return 0
      return Math.min(r.keep, fingerprints(r.base).length)
    },
    resolve: (hash) => lookup.get(hash),
    shape: (shapeHash) => (shapeHash === undefined ? undefined : shapes.get(shapeHash)),
    unresolved: missing,
  }
}
