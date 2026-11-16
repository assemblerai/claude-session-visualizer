/**
 * The session as the renderer sees it (docs/technical-design.md section 3).
 * Main assembles these from the session files; the renderer only lays them out
 * and draws them. No node, electron or DOM imports: all three sides compile it.
 */

export type NodeKind = 'prompt' | 'result' | 'agent' | 'request' | 'tool' | 'mcp-tool' | 'context' | 'compaction'

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export interface Totals {
  usage: Usage
  /** `null` when a model with no known price was used: shown as "no price", never as zero. */
  costUsd: number | null
  requests: number
  toolUses: number
  durationMs: number
}

export interface AgentRun {
  /** The parent's Agent or SendMessage tool node. */
  spawnNodeId: string
  /** This run's 'agent' node. */
  headNodeId: string
  /** Where the report reached the parent; null if it never did. */
  joinNodeId: string | null
}

export interface Agent {
  /** 'main' or the agentId. */
  id: string
  parentId: string | null
  /** 'main' or the helper's type, e.g. `coder-react`. */
  type: string
  description: string
  depth: number
  background: boolean
  finished: boolean
  /** One per start or resume. Empty for the main agent. */
  runs: AgentRun[]
  totals: Totals
}

/** What a file tool did, as its adapter read it from the tool's input. */
export interface FileTouch {
  path: string
  action: 'read' | 'write' | 'edit' | 'delete'
}

export interface GraphNode {
  id: string
  kind: NodeKind
  agentId: string
  run: number
  /** Tool name, model, first words of a prompt. */
  label: string
  /** Epoch ms. */
  startedAt: number
  endedAt: number
  error: boolean
  request?: { model: string; usage: Usage; costUsd: number | null; hasReply: boolean }
  /** `server` is set for MCP tools. */
  tool?: { name: string; server: string | null; file?: FileTouch }
  /**
   * `source` is 'attachment' for context Claude Code attached (environment, skill listing, date…), which the
   * details panel lists under the request it went into rather than the chart drawing it; 'message' for injected
   * text, task notifications and compaction summaries, which stay on the chart.
   */
  context?: { attachmentType: string; source: 'attachment' | 'message' }
  /** The skill that was active, when one was. */
  skill?: string
  bytesIn: number
  bytesOut: number
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: 'flow' | 'spawn' | 'join'
  /** 'in': toward Anthropic or a tool; 'out': a result coming back. */
  direction: 'in' | 'out'
  /** Drives arrow thickness. */
  bytes: number
  label: string
}

export interface SkillSpan {
  skill: string
  agentId: string
  firstNodeId: string
  lastNodeId: string
}

export interface SessionWarning {
  kind: 'unknown-record' | 'invalid-line' | 'unresolved-fingerprint' | 'synthetic-reply' | 'unmatched-helper'
  /** What was seen, e.g. the record kind or the agent id. */
  subject: string
  count: number
}

export interface ModelTotals {
  model: string
  usage: Usage
  costUsd: number | null
}

export interface SessionGraph {
  sessionId: string
  title: string | null
  /** Epoch ms. */
  startedAt: number
  endedAt: number
  /** `agents[0]` is the main agent. */
  agents: Agent[]
  /** Ordered by `startedAt`, then file order. */
  nodes: GraphNode[]
  edges: GraphEdge[]
  skills: SkillSpan[]
  totals: Totals
  /** Our figures per model. */
  byModel: ModelTotals[]
  /**
   * From the last `cost-state` record: Claude Code's own figure. `requests` and `toolUses` are not recorded there and
   * are 0, and its cache writes are often one total with no lifetime split: compare the two lifetimes' sum.
   */
  claudeCodeTotals: Totals | null
  claudeCodeByModel: ModelTotals[]
  warnings: SessionWarning[]
}

export interface Body {
  /** 'System prompt', 'Tools (41)', 'Message 12 · user', 'Command'. */
  title: string
  role?: 'system' | 'user' | 'assistant' | 'tools'
  /** True for request messages carried over from the previous request. */
  repeated: boolean
  format: 'text' | 'json' | 'diff'
  /** The first `BODY_PREVIEW_CHARS` of the body. */
  preview: string
  bytes: number
  /** Set when `preview` is not the whole body. */
  bodyRef: string | null
}

export interface NodeDetail {
  nodeId: string
  input: Body[]
  output: Body[]
}

export interface BodySlice {
  text: string
  /** The offset to ask for next; null when this was the last slice. */
  nextOffset: number | null
}

export const BODY_PREVIEW_CHARS = 20_000
export const BODY_SLICE_CHARS = 100_000

// ---- listing ---------------------------------------------------------------

export interface SessionSummary {
  sessionId: string
  /** The session's main `.jsonl`, as it was imported. */
  path: string
  /** The project folder it sits in: the project's path with slashes turned into dashes. */
  project: string
  /** True when the file is no longer where it was imported from. */
  missing: boolean
  /** Epoch ms the file last changed. */
  modifiedAt: number
  sizeBytes: number
  /** True while the file has not been read yet; the fields below are then empty. */
  pending: boolean
  title: string | null
  startedAt: number | null
  endedAt: number | null
  helperCount: number
  /** Claude Code's own cost figure, from the last `cost-state`. */
  costUsd: number | null
  /** False for a session with no request records: it cannot be opened. */
  hasRequests: boolean
}

export const ZERO_USAGE: Usage = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  }
}

/**
 * An agent's name for labels: its type, then the task it was given. Claude often starts the
 * description with the type already ("coder-react frontend TK-198"), so it is not repeated.
 */
export function agentName(type: string, description: string | null | undefined): string {
  if (!description) return type
  return description.toLowerCase().startsWith(type.toLowerCase()) ? description : `${type}: ${description}`
}

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
}
