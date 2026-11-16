import { isToolResult, isToolUse, type TranscriptRecord } from '../records.js'
import { isObject, MAIN_AGENT, toMs, type SessionFiles } from './types.js'

/**
 * The helper tree and each helper's runs (docs/technical-design.md section 1.5).
 * This decides only *which records* start and end a run; `graph.ts` turns
 * those into nodes and edges.
 */

export type JoinPlan =
  /** Foreground: the parent's tool result is the report. */
  | { via: 'tool-result' }
  /** Background or resumed: the parent record (a task notification or hand-back) that carried the report. */
  | { via: 'record'; uuid: string }

export interface RunPlan {
  /** The parent's `tool_use.id`: the Agent call for run 0, a SendMessage for a later run. */
  spawnToolUseId: string
  /** The helper-file record that starts this run; null for run 0, which starts at the top of the file. */
  startUuid: string | null
  join: JoinPlan | null
}

export interface AgentPlan {
  id: string
  parentId: string | null
  type: string
  description: string
  depth: number
  background: boolean
  finished: boolean
  runs: RunPlan[]
}

export interface AgentPlans {
  /** Main first, then helpers in the order they started. */
  agents: AgentPlan[]
  /** Helpers whose parent, or whose starting tool request, is not in the files. */
  unmatched: string[]
}

interface ParentFacts {
  /** `tool_use.id` of every Agent call. */
  agentCalls: Set<string>
  /** `tool_use.id` → whether its result said the helper was launched in the background. */
  results: Map<string, { async: boolean }>
  /** Helper id → the SendMessage calls that resumed it, in order. */
  resumes: Map<string, string[]>
  /** `<helper id>|<tool-use id>` → the uuid of the task notification about that run. */
  notices: Map<string, string>
  /** Helper id → uuids of its hand-backs, in order. */
  handbacks: Map<string, string[]>
}

const TASK_ID = /<task-id>([^<]+)<\/task-id>/
const TOOL_USE_ID = /<tool-use-id>([^<]+)<\/tool-use-id>/

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (isObject(b) && typeof b.text === 'string' ? b.text : '')).join('\n')
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function readParent(records: readonly TranscriptRecord[]): ParentFacts {
  const facts: ParentFacts = {
    agentCalls: new Set(),
    results: new Map(),
    resumes: new Map(),
    notices: new Map(),
    handbacks: new Map(),
  }
  const sendMessages = new Set<string>()

  for (const r of records) {
    if (r.type === 'assistant') {
      for (const b of r.message.content) {
        if (!isToolUse(b)) continue
        if (b.name === 'Agent') facts.agentCalls.add(b.id)
        else if (b.name === 'SendMessage') sendMessages.add(b.id)
      }
    } else if (r.type === 'user') {
      const content = r.message.content
      const results = Array.isArray(content) ? content.filter(isToolResult) : []
      const structured = isObject(r.toolUseResult) ? r.toolUseResult : {}
      for (const b of results) {
        facts.results.set(b.tool_use_id, { async: structured.isAsync === true || structured.status === 'async_launched' })
        if (sendMessages.has(b.tool_use_id) && typeof structured.resumedAgentId === 'string') {
          push(facts.resumes, structured.resumedAgentId, b.tool_use_id)
        }
      }
      if (results.length === 0 && r.origin?.kind === 'task-notification') {
        const text = textOf(content)
        const helper = TASK_ID.exec(text)?.[1]
        const call = TOOL_USE_ID.exec(text)?.[1]
        if (helper && call) facts.notices.set(`${helper}|${call}`, r.uuid)
      }
    } else if (r.type === 'attachment') {
      const origin = r.attachment.origin
      if (origin?.kind === 'peer' && origin.handback === true && origin.from) push(facts.handbacks, origin.from, r.uuid)
    }
  }
  return facts
}

/** The records in a helper's file that start a resumed run, in order. */
function resumeStarts(records: readonly TranscriptRecord[]): string[] {
  const starts: string[] = []
  for (const r of records) if (r.type === 'user' && r.origin?.kind === 'coordinator') starts.push(r.uuid)
  return starts
}

function firstTimestamp(records: readonly TranscriptRecord[]): number {
  for (const r of records) if ('timestamp' in r && typeof r.timestamp === 'string') return toMs(r.timestamp)
  return 0
}

export function planAgents(files: SessionFiles): AgentPlans {
  const recordsOf = new Map<string, readonly TranscriptRecord[]>([[MAIN_AGENT, files.main.records]])
  for (const h of files.helpers) recordsOf.set(h.agentId, h.transcript.records)

  const facts = new Map<string, ParentFacts>()
  const factsOf = (agentId: string): ParentFacts | undefined => {
    const records = recordsOf.get(agentId)
    if (!records) return undefined
    let known = facts.get(agentId)
    if (!known) facts.set(agentId, (known = readParent(records)))
    return known
  }

  const agents: AgentPlan[] = [
    {
      id: MAIN_AGENT,
      parentId: null,
      type: MAIN_AGENT,
      description: '',
      depth: 0,
      background: false,
      finished: true,
      runs: [],
    },
  ]
  const unmatched: string[] = []
  const helpers = [...files.helpers].sort(
    (a, b) => firstTimestamp(a.transcript.records) - firstTimestamp(b.transcript.records),
  )

  for (const helper of helpers) {
    const parentId = helper.meta.parentAgentId ?? MAIN_AGENT
    const parent = factsOf(parentId)
    if (!parent || !parent.agentCalls.has(helper.meta.toolUseId)) {
      unmatched.push(helper.agentId)
      continue
    }

    const unusedHandbacks = [...(parent.handbacks.get(helper.agentId) ?? [])]
    const reportFor = (toolUseId: string): JoinPlan | null => {
      const notice = parent.notices.get(`${helper.agentId}|${toolUseId}`)
      if (notice) return { via: 'record', uuid: notice }
      const handback = unusedHandbacks.shift()
      return handback ? { via: 'record', uuid: handback } : null
    }

    const started = parent.results.get(helper.meta.toolUseId)
    const background = helper.meta.requestShape === 'background' || started?.async === true
    const runs: RunPlan[] = [
      {
        spawnToolUseId: helper.meta.toolUseId,
        startUuid: null,
        join: background ? reportFor(helper.meta.toolUseId) : started ? { via: 'tool-result' } : null,
      },
    ]

    // The k-th resume record in the helper's file pairs with the k-th
    // SendMessage that resumed it in the parent's. No matching by time.
    const resumes = parent.resumes.get(helper.agentId) ?? []
    resumeStarts(helper.transcript.records).forEach((startUuid, k) => {
      const spawnToolUseId = resumes[k]
      if (spawnToolUseId) runs.push({ spawnToolUseId, startUuid, join: reportFor(spawnToolUseId) })
    })

    agents.push({
      id: helper.agentId,
      parentId,
      type: helper.meta.agentType,
      description: helper.meta.description,
      depth: helper.meta.spawnDepth,
      background,
      finished: helper.meta.finished,
      runs,
    })
  }

  // A helper whose parent was dropped has nowhere to branch from.
  const kept = new Set(agents.map((a) => a.id))
  let changed = true
  while (changed) {
    changed = false
    for (const a of agents) {
      if (a.parentId !== null && !kept.has(a.parentId) && kept.delete(a.id)) {
        unmatched.push(a.id)
        changed = true
      }
    }
  }
  return { agents: agents.filter((a) => kept.has(a.id)), unmatched }
}
