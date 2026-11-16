import {
  addUsage,
  agentName,
  ZERO_USAGE,
  type Agent,
  type AgentRun,
  type GraphEdge,
  type GraphNode,
  type ModelTotals,
  type SessionGraph,
  type SessionWarning,
  type SkillSpan,
  type Totals,
  type Usage,
} from '../../../shared/session.js'
import { Refusal } from '../../errors.js'
import { addCost, costOf } from '../pricing.js'
import {
  isText,
  isToolResult,
  isToolUse,
  type ParseCounts,
  type ToolResultBlock,
  type TranscriptRecord,
} from '../records.js'
import { planAgents, type AgentPlan } from './agents.js'
import { fileTouchOf, mcpServerOf } from './files.js'
import { indexRequests, type RequestIndex } from './requests.js'
import { collectReplies, isSynthetic, type Reply } from './usage.js'
import { isObject, MAIN_AGENT, sizeOf, toMs, type SessionFiles } from './types.js'

/**
 * From records to nodes and edges (docs/technical-design.md section 4).
 * Pure: parsed records in, the graph and what each node's bodies are made of out.
 */

/** Where a node's Input and Output bodies come from. Kept in main; never sent whole. */
export type NodeSource =
  | { kind: 'request'; agentId: string; requestId: string; reply: Reply | null }
  | { kind: 'tool'; name: string; input: unknown; result: ToolResultBlock | null; structured: unknown }
  | { kind: 'agent'; task: unknown; report: unknown }
  | { kind: 'value'; title: string; value: unknown }

export interface Assembled {
  graph: SessionGraph
  sources: Map<string, NodeSource>
  /** One per agent: `base` never crosses files. */
  requestIndexes: Map<string, RequestIndex>
}

const LABEL_CHARS = 60

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 1)}…` : line
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (isObject(b) && typeof b.text === 'string' ? b.text : ''))
    .filter((t) => t !== '')
    .join('\n\n')
}

function emptyTotals(): Totals {
  return { usage: { ...ZERO_USAGE }, costUsd: 0, requests: 0, toolUses: 0, durationMs: 0 }
}

interface Builder {
  nodes: GraphNode[]
  byId: Map<string, GraphNode>
  edges: GraphEdge[]
  sources: Map<string, NodeSource>
  /** `tool_use.id` → node id, across agents: a helper is started from its parent's tool node. */
  toolNodes: Map<string, string>
  /** Record uuid → the context node made from it: where a background report joins. */
  recordNodes: Map<string, string>
  /** `<agent>:<run>` → the run's head node, its last step, and its report. */
  runs: Map<string, { headId: string; lastId: string; report: unknown }>
  byModel: Map<string, ModelTotals>
  synthetic: number
}

function addNode(b: Builder, node: GraphNode, source: NodeSource): GraphNode {
  b.nodes.push(node)
  b.byId.set(node.id, node)
  b.sources.set(node.id, source)
  return node
}

function addEdge(b: Builder, edge: Omit<GraphEdge, 'id'>): GraphEdge {
  const full = { ...edge, id: `e${b.edges.length}` }
  b.edges.push(full)
  return full
}

/** The `tool_use_id`s answered by a request's new messages. */
function answeredIn(index: RequestIndex, tail: readonly string[]): string[] {
  const ids: string[] = []
  for (const hash of tail) {
    const content = index.resolve(hash)?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (isObject(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string')
        ids.push(block.tool_use_id)
    }
  }
  return ids
}

/**
 * The records the walk reads, in time order, with file order breaking ties.
 *
 * File order is not enough: a request record is sometimes written before the
 * reply and tool result that came just before it, so in file order a tool's
 * result can land after the request that carried it back.
 */
function inTimeOrder(records: readonly TranscriptRecord[]): TranscriptRecord[] {
  const sentAt = new Map<string, number>()
  for (const r of records) if (r.type === 'api-request') sentAt.set(r.id, toMs(r.timestamp))

  const timed: { record: TranscriptRecord; at: number; i: number }[] = []
  records.forEach((record, i) => {
    if (!('timestamp' in record) || typeof record.timestamp !== 'string') return
    let at = toMs(record.timestamp)
    // A reply stamped before its own request (two in the whole data set) still follows it.
    const sent =
      record.type === 'assistant' && record.requestRef !== undefined ? sentAt.get(record.requestRef) : undefined
    if (sent !== undefined && at <= sent) at = sent + 0.5
    timed.push({ record, at, i })
  })
  return timed.sort((x, y) => x.at - y.at || x.i - y.i).map((x) => x.record)
}

function walkAgent(b: Builder, plan: AgentPlan, all: readonly TranscriptRecord[], index: RequestIndex): Totals {
  const records = inTimeOrder(all)
  const isMain = plan.id === MAIN_AGENT
  const replies = collectReplies(all)
  const replyOf = new Map<string, Reply>()
  const answerTo = new Map<string, Reply>()
  for (const reply of replies) {
    replyOf.set(reply.messageId, reply)
    if (reply.requestRef !== undefined && !isSynthetic(reply)) answerTo.set(reply.requestRef, reply)
  }
  const runStarts = new Map<string, number>()
  plan.runs.forEach((run, k) => {
    if (run.startUuid !== null) runStarts.set(run.startUuid, k)
  })

  const totals = emptyTotals()
  let run = 0
  let taskSeen = false
  /** Prompt, context and agent-head nodes waiting for the next request. */
  let pending: string[] = []
  /** Tools whose result has arrived but has not been seen going back to Anthropic. */
  const unlinked = new Map<string, { nodeId: string; requestsSeen: number }>()
  const requestNodes: GraphNode[] = []
  const syntheticSeen = new Set<string>()

  const base = (
    at: number,
  ): Pick<GraphNode, 'agentId' | 'run' | 'startedAt' | 'endedAt' | 'error' | 'bytesIn' | 'bytesOut'> => ({
    agentId: plan.id,
    run,
    startedAt: at,
    endedAt: at,
    error: false,
    bytesIn: 0,
    bytesOut: 0,
  })

  const startRun = (k: number, at: number, task: unknown): void => {
    run = k
    const id = `agent:${plan.id}:${k}`
    addNode(
      b,
      { ...base(at), id, kind: 'agent', label: plan.type, bytesIn: sizeOf(task) },
      { kind: 'agent', task, report: null },
    )
    b.runs.set(`${plan.id}:${k}`, { headId: id, lastId: id, report: null })
    pending.push(id)
  }

  const context = (
    uuid: string,
    at: number,
    label: string,
    attachmentType: string,
    value: unknown,
    source: 'attachment' | 'message' = 'message',
  ): void => {
    const id = `ctx:${uuid}`
    addNode(
      b,
      { ...base(at), id, kind: 'context', label, context: { attachmentType, source }, bytesOut: sizeOf(value) },
      { kind: 'value', title: label, value },
    )
    b.recordNodes.set(uuid, id)
    pending.push(id)
  }

  if (!isMain) {
    const first = records[0]
    startRun(0, first && 'timestamp' in first && typeof first.timestamp === 'string' ? toMs(first.timestamp) : 0, null)
  }

  for (const record of records) {
    if (record.type === 'user') {
      const at = toMs(record.timestamp)
      const content = record.message.content
      const results = Array.isArray(content) ? content.filter(isToolResult) : []

      for (const block of results) {
        const nodeId = b.toolNodes.get(block.tool_use_id)
        const node = nodeId === undefined ? undefined : b.byId.get(nodeId)
        const source = nodeId === undefined ? undefined : b.sources.get(nodeId)
        if (!node || source?.kind !== 'tool') continue
        node.endedAt = Math.max(node.startedAt, at)
        node.error = block.is_error === true
        node.bytesOut = sizeOf(block.content)
        source.result = block
        source.structured = record.toolUseResult
        unlinked.set(block.tool_use_id, { nodeId: node.id, requestsSeen: requestNodes.length })
      }
      if (results.length > 0) continue

      const resumed = runStarts.get(record.uuid)
      if (resumed !== undefined) {
        startRun(resumed, at, content)
      } else if (!isMain && !taskSeen && record.isMeta !== true) {
        // The helper's one real prompt is its task: the input of run 0's agent node.
        taskSeen = true
        const head = b.byId.get(`agent:${plan.id}:0`)
        const source = b.sources.get(`agent:${plan.id}:0`)
        if (head && source?.kind === 'agent') {
          source.task = content
          head.bytesIn = sizeOf(content)
        }
      } else if (record.origin?.kind === 'task-notification') {
        context(record.uuid, at, 'task notification', 'task-notification', content)
      } else if (record.isCompactSummary === true) {
        context(record.uuid, at, 'compaction summary', 'compact-summary', content)
      } else if (record.isMeta === true || !isMain) {
        context(record.uuid, at, 'injected text', 'injected-text', content)
      } else {
        const id = `prompt:${record.uuid}`
        const text = textOf(content)
        addNode(
          b,
          { ...base(at), id, kind: 'prompt', label: clip(text) || 'Prompt', bytesOut: sizeOf(content) },
          { kind: 'value', title: 'Prompt', value: content },
        )
        pending.push(id)
      }
    } else if (record.type === 'attachment') {
      const kind = record.attachment.type
      context(
        record.uuid,
        toMs(record.timestamp),
        kind.replace(/_/g, ' '),
        kind,
        record.rendered ?? record.attachment,
        'attachment',
      )
    } else if (record.type === 'api-request') {
      const at = toMs(record.timestamp)
      const reply = answerTo.get(record.id) ?? null
      const model = record.params.model ?? reply?.model ?? 'unknown'
      const usage: Usage = reply ? reply.usage : { ...ZERO_USAGE }
      const costUsd = reply ? costOf(usage, model) : 0
      let bytesIn = 0
      for (const hash of record.tail) bytesIn += sizeOf(index.resolve(hash))

      const id = `req:${record.id}`
      const node = addNode(
        b,
        {
          ...base(at),
          id,
          kind: 'request',
          label: reply ? model : `${model} · no reply recorded`,
          // Two requests in the whole data set have a reply stamped before the request.
          endedAt: reply ? Math.max(at, reply.lastAt) : at,
          error: reply?.isApiError === true,
          request: { model, usage, costUsd, hasReply: reply !== null },
          bytesIn,
          bytesOut: reply ? sizeOf(reply.content) : 0,
        },
        { kind: 'request', agentId: plan.id, requestId: record.id, reply },
      )
      const skill = reply?.records[0]?.attributionSkill
      if (skill) node.skill = skill
      requestNodes.push(node)

      for (const from of pending) {
        const source = b.byId.get(from)
        const bytes = source?.kind === 'agent' ? source.bytesIn : (source?.bytesOut ?? 0)
        addEdge(b, { from, to: id, kind: 'flow', direction: 'in', bytes, label: source?.label ?? '' })
      }
      pending = []
      for (const toolUseId of answeredIn(index, record.tail)) {
        const tool = unlinked.get(toolUseId)
        if (!tool) continue
        const source = b.byId.get(tool.nodeId)
        addEdge(b, {
          from: tool.nodeId,
          to: id,
          kind: 'flow',
          direction: 'out',
          bytes: source?.bytesOut ?? 0,
          label: source?.label ?? '',
        })
        unlinked.delete(toolUseId)
      }

      const state = b.runs.get(`${plan.id}:${run}`)
      if (state) state.lastId = id
      totals.requests += 1
      totals.usage = addUsage(totals.usage, usage)
      totals.costUsd = addCost(totals.costUsd, costUsd)
      if (reply) {
        const known = b.byModel.get(model) ?? { model, usage: { ...ZERO_USAGE }, costUsd: 0 }
        b.byModel.set(model, { model, usage: addUsage(known.usage, usage), costUsd: addCost(known.costUsd, costUsd) })
      }
    } else if (record.type === 'assistant') {
      const reply = replyOf.get(record.message.id)
      if (!reply) continue
      if (isSynthetic(reply)) {
        if (!syntheticSeen.has(reply.messageId)) b.synthetic += 1
        syntheticSeen.add(reply.messageId)
        continue
      }
      const requestId = `req:${reply.requestRef}`
      if (!b.byId.has(requestId)) continue
      const at = toMs(record.timestamp)

      for (const block of record.message.content) {
        if (!isToolUse(block)) continue
        const server = mcpServerOf(block.name)
        const id = `tool:${block.id}`
        const file = fileTouchOf(block.name, block.input)
        const node = addNode(
          b,
          {
            ...base(at),
            id,
            kind: server === null ? 'tool' : 'mcp-tool',
            label: server === null ? block.name : block.name.slice(`mcp__${server}__`.length) || block.name,
            tool: file ? { name: block.name, server, file } : { name: block.name, server },
            bytesIn: sizeOf(block.input),
          },
          { kind: 'tool', name: block.name, input: block.input, result: null, structured: undefined },
        )
        if (record.attributionSkill) node.skill = record.attributionSkill
        b.toolNodes.set(block.id, id)
        // The join leaves from the run's last step, which may be a tool (a hand-back).
        const state = b.runs.get(`${plan.id}:${run}`)
        if (state) state.lastId = id
        addEdge(b, { from: requestId, to: id, kind: 'flow', direction: 'in', bytes: node.bytesIn, label: node.label })
        totals.toolUses += 1
      }

      const last = reply.records[reply.records.length - 1]
      if (last !== record || reply.stopReason !== 'end_turn') continue
      const text = textOf(reply.content.filter(isText))
      if (isMain) {
        const id = `result:${record.uuid}`
        addNode(
          b,
          { ...base(at), id, kind: 'result', label: clip(text) || 'Result', bytesOut: sizeOf(text) },
          { kind: 'value', title: 'Result', value: text },
        )
        addEdge(b, { from: requestId, to: id, kind: 'flow', direction: 'out', bytes: sizeOf(text), label: 'result' })
      } else {
        // A helper's final words are its report: the output of the run's agent node.
        const state = b.runs.get(`${plan.id}:${run}`)
        const head = state ? b.byId.get(state.headId) : undefined
        const source = state ? b.sources.get(state.headId) : undefined
        if (state && head && source?.kind === 'agent') {
          state.report = text
          source.report = text
          head.bytesOut = sizeOf(text)
        }
      }
    } else if (record.type === 'system' && record.subtype === 'compact_boundary') {
      const at = toMs(record.timestamp)
      addNode(
        b,
        { ...base(at), id: `compaction:${record.uuid}`, kind: 'compaction', label: 'Compaction' },
        { kind: 'value', title: 'Compaction', value: record.compactMetadata ?? null },
      )
    }
  }

  // A result the request scan did not find goes to the next request after it.
  for (const tool of unlinked.values()) {
    const next = requestNodes[tool.requestsSeen]
    const source = b.byId.get(tool.nodeId)
    if (next)
      addEdge(b, {
        from: tool.nodeId,
        to: next.id,
        kind: 'flow',
        direction: 'out',
        bytes: source?.bytesOut ?? 0,
        label: source?.label ?? '',
      })
  }

  return totals
}

/** Runs of consecutive request and tool nodes of one agent under the same skill. */
function skillSpans(nodes: readonly GraphNode[]): SkillSpan[] {
  const spans: SkillSpan[] = []
  const open = new Map<string, SkillSpan>()
  for (const node of nodes) {
    if (node.kind !== 'request' && node.kind !== 'tool' && node.kind !== 'mcp-tool') continue
    const current = open.get(node.agentId)
    if (current && current.skill === node.skill) {
      current.lastNodeId = node.id
      continue
    }
    open.delete(node.agentId)
    if (node.skill === undefined) continue
    const span = { skill: node.skill, agentId: node.agentId, firstNodeId: node.id, lastNodeId: node.id }
    spans.push(span)
    open.set(node.agentId, span)
  }
  return spans
}

function warningsOf(
  files: SessionFiles,
  indexes: Map<string, RequestIndex>,
  synthetic: number,
  unmatched: string[],
): SessionWarning[] {
  const kinds = new Map<string, number>()
  let invalid = 0
  const count = (counts: ParseCounts): void => {
    invalid += counts.invalidLines
    for (const [kind, n] of Object.entries(counts.unknownKinds)) kinds.set(kind, (kinds.get(kind) ?? 0) + n)
  }
  count(files.main.counts)
  for (const h of files.helpers) count(h.transcript.counts)

  const warnings: SessionWarning[] = []
  for (const [subject, n] of kinds) warnings.push({ kind: 'unknown-record', subject, count: n })
  if (invalid > 0) warnings.push({ kind: 'invalid-line', subject: 'lines that could not be read', count: invalid })
  let unresolved = 0
  for (const index of indexes.values()) unresolved += index.unresolved.length
  if (unresolved > 0)
    warnings.push({
      kind: 'unresolved-fingerprint',
      subject: 'messages whose content was not recorded',
      count: unresolved,
    })
  if (synthetic > 0)
    warnings.push({ kind: 'synthetic-reply', subject: 'messages Claude Code wrote itself', count: synthetic })
  for (const subject of unmatched) warnings.push({ kind: 'unmatched-helper', subject, count: 1 })
  return warnings
}

function claudeCodeFigures(records: readonly TranscriptRecord[]): { totals: Totals | null; byModel: ModelTotals[] } {
  let last: Extract<TranscriptRecord, { type: 'cost-state' }> | undefined
  for (const r of records) if (r.type === 'cost-state') last = r
  if (!last) return { totals: null, byModel: [] }
  const byModel = Object.entries(last.modelUsage).map(([model, u]) => {
    // Claude Code often records only the two lifetimes' total. It is kept
    // under the 5-minute heading then, and the screens compare the sum.
    const split = u.cacheCreationEphemeral5mInputTokens + u.cacheCreationEphemeral1hInputTokens > 0
    return {
      model,
      usage: {
        input: u.inputTokens,
        output: u.outputTokens,
        cacheRead: u.cacheReadInputTokens,
        cacheWrite5m: split ? u.cacheCreationEphemeral5mInputTokens : u.cacheCreationInputTokens,
        cacheWrite1h: split ? u.cacheCreationEphemeral1hInputTokens : 0,
      },
      costUsd: u.costUSD,
    }
  })
  return {
    totals: {
      usage: byModel.reduce((sum, m) => addUsage(sum, m.usage), { ...ZERO_USAGE }),
      costUsd: last.totalCostUSD,
      requests: 0,
      toolUses: 0,
      durationMs: last.totalDuration,
    },
    byModel,
  }
}

export function assemble(files: SessionFiles): Assembled {
  if (!files.main.records.some((r) => r.type === 'api-request')) {
    throw new Refusal(
      'This session has no request records, so there is nothing to draw. Sessions recorded by Claude Code before 2.1.300 are not supported.',
      'PRECONDITION_FAILED',
    )
  }

  const plans = planAgents(files)
  const recordsOf = new Map<string, readonly TranscriptRecord[]>([[MAIN_AGENT, files.main.records]])
  for (const h of files.helpers) recordsOf.set(h.agentId, h.transcript.records)

  const b: Builder = {
    nodes: [],
    byId: new Map(),
    edges: [],
    sources: new Map(),
    toolNodes: new Map(),
    recordNodes: new Map(),
    runs: new Map(),
    byModel: new Map(),
    synthetic: 0,
  }
  const requestIndexes = new Map<string, RequestIndex>()
  const totalsOf = new Map<string, Totals>()

  for (const plan of plans.agents) {
    const records = recordsOf.get(plan.id) ?? []
    const index = indexRequests(records)
    requestIndexes.set(plan.id, index)
    totalsOf.set(plan.id, walkAgent(b, plan, records, index))
  }

  // Between agents: a spawn into each run, and a join where its report landed.
  const agents: Agent[] = []
  for (const plan of plans.agents) {
    const runs: AgentRun[] = []
    plan.runs.forEach((run, k) => {
      const state = b.runs.get(`${plan.id}:${k}`)
      const spawnNodeId = b.toolNodes.get(run.spawnToolUseId)
      const head = state ? b.byId.get(state.headId) : undefined
      if (!state || !head || spawnNodeId === undefined) return
      addEdge(b, {
        from: spawnNodeId,
        to: head.id,
        kind: 'spawn',
        direction: 'in',
        bytes: head.bytesIn,
        label: agentName(plan.type, plan.description),
      })

      let joinNodeId: string | null = null
      if (run.join?.via === 'record') joinNodeId = b.recordNodes.get(run.join.uuid) ?? null
      else if (run.join?.via === 'tool-result') {
        // The report is carried by the join and drawn once: the tool's own
        // arrow to the request stays, so the parent's line is unbroken, but empty.
        const back = b.edges.find((e) => e.from === spawnNodeId && e.kind === 'flow' && e.direction === 'out')
        if (back) {
          back.bytes = 0
          joinNodeId = back.to
        }
      }
      if (joinNodeId !== null) {
        // A helper that ended on a hand-back tool has no final words of its
        // own: its report is what the parent was handed.
        if (state.report === null) {
          const spawned = b.sources.get(spawnNodeId)
          const landed = b.sources.get(joinNodeId)
          const handed =
            run.join?.via === 'tool-result' && spawned?.kind === 'tool'
              ? (spawned.result?.content ?? null)
              : landed?.kind === 'value'
                ? landed.value
                : null
          const source = b.sources.get(head.id)
          if (handed !== null && source?.kind === 'agent') {
            state.report = handed
            source.report = handed
            head.bytesOut = sizeOf(handed)
          }
        }
        addEdge(b, {
          from: state.lastId,
          to: joinNodeId,
          kind: 'join',
          direction: 'out',
          bytes: sizeOf(state.report),
          label: 'report',
        })
      }
      runs.push({ spawnNodeId, headNodeId: head.id, joinNodeId })
    })

    const totals = totalsOf.get(plan.id) ?? emptyTotals()
    const own = b.nodes.filter((n) => n.agentId === plan.id)
    if (plan.id === MAIN_AGENT) {
      totals.durationMs =
        own.length === 0 ? 0 : Math.max(...own.map((n) => n.endedAt)) - Math.min(...own.map((n) => n.startedAt))
    } else {
      // An agent node spans its run; the helper's time is the sum of its runs.
      plan.runs.forEach((_, k) => {
        const head = b.byId.get(`agent:${plan.id}:${k}`)
        if (!head) return
        for (const n of own) if (n.run === k) head.endedAt = Math.max(head.endedAt, n.endedAt)
        totals.durationMs += head.endedAt - head.startedAt
      })
    }
    agents.push({
      id: plan.id,
      parentId: plan.parentId,
      type: plan.type,
      description: plan.description,
      depth: plan.depth,
      background: plan.background,
      finished: plan.finished,
      runs,
      totals,
    })
  }

  // Stable: nodes of one agent that share a timestamp stay in file order.
  const nodes = b.nodes
    .map((node, i) => ({ node, i }))
    .sort((x, y) => x.node.startedAt - y.node.startedAt || x.i - y.i)
    .map((x) => x.node)

  const startedAt = nodes.length === 0 ? 0 : (nodes[0] as GraphNode).startedAt
  const endedAt = nodes.reduce((max, n) => Math.max(max, n.endedAt), startedAt)
  const totals = emptyTotals()
  for (const agent of agents) {
    totals.usage = addUsage(totals.usage, agent.totals.usage)
    totals.costUsd = addCost(totals.costUsd, agent.totals.costUsd)
    totals.requests += agent.totals.requests
    totals.toolUses += agent.totals.toolUses
  }
  totals.durationMs = endedAt - startedAt

  let title: string | null = null
  for (const r of files.main.records) if (r.type === 'ai-title') title = r.aiTitle
  const claudeCode = claudeCodeFigures(files.main.records)

  return {
    graph: {
      sessionId: files.sessionId,
      title,
      startedAt,
      endedAt,
      agents,
      nodes,
      edges: b.edges,
      skills: skillSpans(b.nodes),
      totals,
      byModel: [...b.byModel.values()],
      claudeCodeTotals: claudeCode.totals,
      claudeCodeByModel: claudeCode.byModel,
      warnings: warningsOf(files, requestIndexes, b.synthetic, plans.unmatched),
    },
    sources: b.sources,
    requestIndexes,
  }
}
