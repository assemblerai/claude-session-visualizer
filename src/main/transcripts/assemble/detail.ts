import { BODY_PREVIEW_CHARS, type Body, type NodeDetail } from '../../../shared/session.js'
import { isText, isThinking, isToolUse } from '../records.js'
import type { NodeSource } from './graph.js'
import type { RequestIndex } from './requests.js'
import { isObject } from './types.js'

/**
 * A node's Input and Output bodies (docs/technical-design.md section 4,
 * "Detail bodies"). Built on demand, when a node is clicked: a single
 * request's input is often several hundred kilobytes.
 */

/** A body with its whole text, before it is cut to a preview for the renderer. */
export interface FullBody {
  title: string
  role?: Body['role']
  repeated: boolean
  format: Body['format']
  text: string
}

export interface FullDetail {
  input: FullBody[]
  output: FullBody[]
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? ''
}

/** Text when the content is only text; otherwise the blocks as JSON, so nothing is hidden. */
function render(content: unknown): Pick<FullBody, 'format' | 'text'> {
  if (typeof content === 'string') return { format: 'text', text: content }
  if (Array.isArray(content) && content.length > 0 && content.every((b) => isObject(b) && b.type === 'text' && typeof b.text === 'string')) {
    return { format: 'text', text: content.map((b) => (b as { text: string }).text).join('\n\n') }
  }
  // An attachment's rendered form: the text blocks Claude Code put into the request.
  if (Array.isArray(content) && content.length > 0 && content.every((b) => isObject(b) && b.type === undefined && typeof b.content === 'string')) {
    return { format: 'text', text: content.map((b) => (b as { content: string }).content).join('\n\n') }
  }
  if (content === null || content === undefined) return { format: 'text', text: '' }
  return { format: 'json', text: pretty(content) }
}

function body(title: string, content: unknown, extra: Partial<FullBody> = {}): FullBody {
  return { title, repeated: false, ...render(content), ...extra }
}

function roleOf(role: string): Body['role'] {
  return role === 'user' || role === 'assistant' || role === 'system' ? role : undefined
}

function requestDetail(source: Extract<NodeSource, { kind: 'request' }>, index: RequestIndex | undefined): FullDetail {
  const input: FullBody[] = []
  const request = index?.byId.get(source.requestId)
  if (index && request) {
    const shape = index.shape(request.shapeHash)
    if (shape) {
      input.push(body('System prompt', shape.system, { role: 'system', repeated: true }))
      input.push(body(`Tools (${shape.tools.length})`, shape.tools, { role: 'tools', repeated: true }))
    }
    const kept = index.kept(request.id)
    index.fingerprints(request.id).forEach((hash, i) => {
      const message = index.resolve(hash)
      const repeated = i < kept
      if (!message) {
        input.push({ title: `Message ${i + 1} · content not recorded`, repeated, format: 'text', text: `fingerprint ${hash}` })
        return
      }
      const role = roleOf(message.role)
      input.push(body(`Message ${i + 1} · ${message.role}`, message.content, role ? { role, repeated } : { repeated }))
    })
  }

  const output: FullBody[] = []
  for (const block of source.reply?.content ?? []) {
    if (isThinking(block)) output.push(body('Thinking', block.thinking || '(thinking was not recorded)', { role: 'assistant' }))
    else if (isText(block)) output.push(body('Text', block.text, { role: 'assistant' }))
    else if (isToolUse(block)) output.push(body(`Tool request · ${block.name}`, block.input, { role: 'assistant' }))
    else output.push(body(block.type, block, { role: 'assistant' }))
  }
  return { input, output }
}

interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

function isHunk(value: unknown): value is Hunk {
  return isObject(value) && Array.isArray(value.lines) && typeof value.oldStart === 'number'
}

/** The change a file tool made, as a unified diff, when the records say what it was. */
function diffOf(input: unknown, structured: unknown): string | null {
  if (isObject(structured) && Array.isArray(structured.structuredPatch) && structured.structuredPatch.length > 0) {
    return structured.structuredPatch
      .filter(isHunk)
      .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n'))
      .join('\n')
  }
  // Tools whose result is opaque (the dev-tools file tools) still say what they were asked to replace.
  if (isObject(input) && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
    const removed = input.old_string.split('\n').map((line) => `-${line}`)
    const added = input.new_string.split('\n').map((line) => `+${line}`)
    return [...removed, ...added].join('\n')
  }
  return null
}

function toolDetail(source: Extract<NodeSource, { kind: 'tool' }>): FullDetail {
  const onlyCommand = isObject(source.input) && Object.keys(source.input).length === 1 && typeof source.input.command === 'string'
  const input = [onlyCommand ? body('Command', (source.input as { command: string }).command) : body('Input', source.input)]

  const output: FullBody[] = []
  const diff = diffOf(source.input, source.structured)
  if (diff !== null) output.push({ title: 'Change', repeated: false, format: 'diff', text: diff })
  if (source.result) output.push(body(source.result.is_error === true ? 'Error' : 'Result', source.result.content ?? ''))
  return { input, output }
}

export function buildDetail(source: NodeSource, indexes: ReadonlyMap<string, RequestIndex>): FullDetail {
  switch (source.kind) {
    case 'request':
      return requestDetail(source, indexes.get(source.agentId))
    case 'tool':
      return toolDetail(source)
    case 'agent':
      return {
        input: [body('Task', source.task)],
        output: source.report === null ? [] : [body('Report', source.report)],
      }
    case 'value':
      return { input: [], output: [body(source.title, source.value)] }
  }
}

function toBody(full: FullBody, bodyRef: string): Body {
  const whole = full.text.length <= BODY_PREVIEW_CHARS
  const out: Body = {
    title: full.title,
    repeated: full.repeated,
    format: full.format,
    preview: whole ? full.text : full.text.slice(0, BODY_PREVIEW_CHARS),
    bytes: Buffer.byteLength(full.text),
    bodyRef: whole ? null : bodyRef,
  }
  if (full.role) out.role = full.role
  return out
}

/** `<node id>|in:3`: which body of which node a `bodyRef` names. */
export function bodyRefOf(nodeId: string, side: 'in' | 'out', i: number): string {
  return `${nodeId}|${side}:${i}`
}

export function parseBodyRef(bodyRef: string): { nodeId: string; side: 'in' | 'out'; i: number } | null {
  const match = /^(.*)\|(in|out):(\d+)$/s.exec(bodyRef)
  if (!match) return null
  return { nodeId: match[1] as string, side: match[2] as 'in' | 'out', i: Number(match[3]) }
}

export function toNodeDetail(nodeId: string, detail: FullDetail): NodeDetail {
  return {
    nodeId,
    input: detail.input.map((b, i) => toBody(b, bodyRefOf(nodeId, 'in', i))),
    output: detail.output.map((b, i) => toBody(b, bodyRefOf(nodeId, 'out', i))),
  }
}
