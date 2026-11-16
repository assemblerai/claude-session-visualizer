import { describe, expect, it } from 'vitest'
import type { NodeKind, SessionGraph } from '../../../shared/session.js'
import { totalTokens } from '../../../shared/session.js'
import { Refusal } from '../../errors.js'
import { FIXTURE_NAMES, loadFixtureFiles } from '../fixtures.js'
import { parseTranscript } from '../records.js'
import { buildDetail, toNodeDetail } from './detail.js'
import { assemble } from './graph.js'
import { isObject } from './types.js'

function kinds(graph: SessionGraph): Partial<Record<NodeKind, number>> {
  const counts: Partial<Record<NodeKind, number>> = {}
  for (const n of graph.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1
  return counts
}

function edgeKinds(graph: SessionGraph): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const e of graph.edges) counts[`${e.kind}:${e.direction}`] = (counts[`${e.kind}:${e.direction}`] ?? 0) + 1
  return counts
}

describe('assemble, node and edge counts per fixture', () => {
  it('plain', () => {
    const { graph } = assemble(loadFixtureFiles('plain'))

    expect(kinds(graph)).toEqual({ context: 12, prompt: 3, request: 5, 'mcp-tool': 3, result: 3 })
    expect(edgeKinds(graph)).toEqual({ 'flow:in': 18, 'flow:out': 6 })
    expect(graph.warnings).toEqual([])
  })

  it('one-helper', () => {
    const { graph } = assemble(loadFixtureFiles('one-helper'))

    expect(kinds(graph)).toEqual({ prompt: 6, context: 24, request: 8, result: 5, tool: 3, agent: 1 })
    expect(edgeKinds(graph)).toEqual({ 'flow:in': 34, 'flow:out': 7, 'spawn:in': 1, 'join:out': 1 })
    expect(graph.title).not.toBeNull()
  })

  it('nested', () => {
    const { graph } = assemble(loadFixtureFiles('nested'))

    expect(kinds(graph)).toMatchObject({ request: 82, agent: 3, prompt: 15, result: 2 })
    expect(edgeKinds(graph)).toMatchObject({ 'spawn:in': 3, 'join:out': 2 })
    expect(graph.warnings).toEqual([
      { kind: 'synthetic-reply', subject: 'messages Claude Code wrote itself', count: 13 },
    ])
  })
})

describe('assemble, on every fixture', () => {
  it.each(FIXTURE_NAMES)('%s: nodes are in time order, ids are unique and every edge has both ends', (name) => {
    const { graph } = assemble(loadFixtureFiles(name))
    const ids = new Set(graph.nodes.map((n) => n.id))

    expect(ids.size).toBe(graph.nodes.length)
    for (let i = 1; i < graph.nodes.length; i++) {
      expect(graph.nodes[i]!.startedAt).toBeGreaterThanOrEqual(graph.nodes[i - 1]!.startedAt)
    }
    for (const e of graph.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true)
    for (const n of graph.nodes) expect(n.endedAt).toBeGreaterThanOrEqual(n.startedAt)
  })

  it.each(FIXTURE_NAMES)('%s: a tool result goes back to one request, the next one of its agent', (name) => {
    const { graph, sources } = assemble(loadFixtureFiles(name))
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    for (const n of graph.nodes) {
      const source = sources.get(n.id)
      if (source?.kind !== 'tool' || source.result === null) continue
      const back = graph.edges.filter((e) => e.from === n.id && e.kind === 'flow' && e.direction === 'out')
      const later = graph.nodes.some((x) => x.kind === 'request' && x.agentId === n.agentId && x.startedAt >= n.endedAt)

      // The last tool of an agent that then stopped has no request to go back to.
      expect(back).toHaveLength(later ? 1 : 0)
      for (const e of back) expect(byId.get(e.to)).toMatchObject({ kind: 'request', agentId: n.agentId })
    }
  })

  it.each(FIXTURE_NAMES)('%s: session totals are the sum of the agents', (name) => {
    const { graph } = assemble(loadFixtureFiles(name))

    expect(graph.totals.requests).toBe(graph.agents.reduce((n, a) => n + a.totals.requests, 0))
    expect(graph.totals.requests).toBe(graph.nodes.filter((n) => n.kind === 'request').length)
    expect(totalTokens(graph.totals.usage)).toBe(graph.agents.reduce((n, a) => n + totalTokens(a.totals.usage), 0))
    expect(graph.totals.costUsd).toBeGreaterThan(0)
  })
})

describe('assemble, helpers', () => {
  it("agrees with the parent's own record of a foreground helper", () => {
    const files = loadFixtureFiles('one-helper')
    const { graph } = assemble(files)
    const helper = graph.agents[1]
    const reported = files.main.records.flatMap((r) =>
      r.type === 'user' && isObject(r.toolUseResult) && r.toolUseResult.agentId === helper?.id ? [r.toolUseResult] : [],
    )[0]
    const requests = graph.nodes.filter((n) => n.kind === 'request' && n.agentId === helper?.id)
    const last = requests[requests.length - 1]?.request

    // `totalTokens` is the size of the helper's last request, not a running sum.
    expect(last && totalTokens(last.usage)).toBe(reported?.totalTokens)
    expect(helper?.totals.toolUses).toBe(reported?.totalToolUseCount)
  })

  it('draws a foreground report once: on the join, not on the tool arrow', () => {
    const { graph } = assemble(loadFixtureFiles('one-helper'))
    const run = graph.agents[1]?.runs[0]
    const join = graph.edges.find((e) => e.kind === 'join')
    const back = graph.edges.find((e) => e.from === run?.spawnNodeId && e.direction === 'out')

    expect(join?.to).toBe(run?.joinNodeId)
    expect(join?.bytes).toBeGreaterThan(0)
    expect(back).toMatchObject({ to: run?.joinNodeId, bytes: 0 })
  })

  it('joins a background helper at the notice that it finished, and resumes it as a second run', () => {
    const { graph } = assemble(loadFixtureFiles('nested'))
    const helper = graph.agents[1]
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))

    expect(helper?.runs).toHaveLength(2)
    for (const run of helper?.runs ?? []) {
      expect(byId.get(run.joinNodeId ?? '')).toMatchObject({
        kind: 'context',
        agentId: 'main',
        context: { attachmentType: 'task-notification' },
      })
      expect(byId.get(run.headNodeId)?.kind).toBe('agent')
    }
    expect(byId.get(helper?.runs[1]?.spawnNodeId ?? '')?.label).toBe('SendMessage')
    expect(graph.nodes.some((n) => n.agentId === helper?.id && n.run === 1 && n.kind === 'request')).toBe(true)
  })

  it('leaves the branch of a helper that never reported open', () => {
    const { graph } = assemble(loadFixtureFiles('nested'))

    expect(graph.agents[2]).toMatchObject({ parentId: 'a440e649178b9695b', depth: 2, runs: [{ joinNodeId: null }] })
  })
})

describe('assemble, rare shapes', () => {
  const stamp = (s: number): string => `2026-11-15T00:00:${String(s).padStart(2, '0')}.000Z`
  const prompt = JSON.stringify({
    type: 'user',
    uuid: 'u1',
    timestamp: stamp(0),
    message: { role: 'user', content: 'hi' },
  })
  const request = (id: string, s: number): string =>
    JSON.stringify({ type: 'api-request', id, timestamp: stamp(s), params: { model: 'claude-next-9' }, tail: ['f00d'] })

  it('refuses a session with no request records', () => {
    const files = { sessionId: 's', main: parseTranscript(prompt), helpers: [] }

    expect(() => assemble(files)).toThrow(Refusal)
  })

  it('draws a request with no reply as one, and not as an error', () => {
    const { graph } = assemble({
      sessionId: 's',
      main: parseTranscript([prompt, request('r1', 1)].join('\n')),
      helpers: [],
    })
    const node = graph.nodes.find((n) => n.kind === 'request')

    expect(node).toMatchObject({
      error: false,
      request: { hasReply: false },
      label: 'claude-next-9 · no reply recorded',
    })
  })

  it('shows an unresolved fingerprint as "content not recorded", and warns', () => {
    const { graph, sources, requestIndexes } = assemble({
      sessionId: 's',
      main: parseTranscript([prompt, request('r1', 1)].join('\n')),
      helpers: [],
    })
    const source = sources.get('req:r1')
    if (!source) throw new Error('no request node')
    const detail = toNodeDetail('req:r1', buildDetail(source, requestIndexes))

    expect(detail.input).toEqual([
      expect.objectContaining({ title: 'Message 1 · content not recorded', preview: 'fingerprint f00d' }),
    ])
    expect(graph.warnings).toContainEqual({
      kind: 'unresolved-fingerprint',
      subject: 'messages whose content was not recorded',
      count: 1,
    })
  })

  it('shows "no price", never zero, for a model it has no price for', () => {
    const reply = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      timestamp: stamp(2),
      requestRef: 'r1',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-next-9',
        content: [{ type: 'text', text: 'yo' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    const { graph } = assemble({
      sessionId: 's',
      main: parseTranscript([prompt, request('r1', 1), reply].join('\n')),
      helpers: [],
    })

    expect(graph.totals.costUsd).toBeNull()
    expect(graph.nodes.map((n) => n.kind)).toEqual(['prompt', 'request', 'result'])
  })

  it('counts an unknown record kind in the warnings', () => {
    const { graph } = assemble({
      sessionId: 's',
      main: parseTranscript([prompt, request('r1', 1), '{"type":"brand-new"}'].join('\n')),
      helpers: [],
    })

    expect(graph.warnings).toContainEqual({ kind: 'unknown-record', subject: 'brand-new', count: 1 })
  })
})

describe('buildDetail', () => {
  const { graph, sources, requestIndexes } = assemble(loadFixtureFiles('one-helper'))
  const detailOf = (id: string): ReturnType<typeof toNodeDetail> => {
    const source = sources.get(id)
    if (!source) throw new Error(`no node ${id}`)
    return toNodeDetail(id, buildDetail(source, requestIndexes))
  }

  it("shows a request's system prompt, tools and messages, with repeated and new parts separated", () => {
    const requests = graph.nodes.filter((n) => n.kind === 'request' && n.agentId === 'main')
    const { input, output } = detailOf(requests[1]!.id)

    expect(input[0]).toMatchObject({ title: 'System prompt', role: 'system' })
    expect(input[1]?.title).toMatch(/^Tools \(\d+\)$/)
    const messages = input.slice(2)
    expect(messages.some((m) => m.repeated)).toBe(true)
    expect(messages[messages.length - 1]?.repeated).toBe(false)
    expect(output.length).toBeGreaterThan(0)
  })

  it("shows a tool's input and its result", () => {
    const tool = graph.nodes.find((n) => n.kind === 'tool' && n.label === 'WebFetch')
    const { input, output } = detailOf(tool?.id ?? '')

    expect(input).toHaveLength(1)
    expect(output[0]?.title).toBe('Result')
  })

  it("shows a helper's task and its report", () => {
    const { input, output } = detailOf(graph.agents[1]?.runs[0]?.headNodeId ?? '')

    expect(input[0]).toMatchObject({ title: 'Task', format: 'text' })
    expect(input[0]?.preview).not.toBe('')
    expect(output.map((b) => b.title)).toEqual(['Report'])
  })

  it('shows an edit as a diff', () => {
    const detail = buildDetail(
      {
        kind: 'tool',
        name: 'mcp__dev-tools__edit_file',
        input: { path: 'a.ts', old_string: 'one', new_string: 'two\nthree' },
        result: null,
        structured: 'ok',
      },
      new Map(),
    )

    expect(detail.output).toEqual([{ title: 'Change', repeated: false, format: 'diff', text: '-one\n+two\n+three' }])
  })

  it('cuts a long body to a preview and names where the rest is', () => {
    const detail = toNodeDetail(
      'n',
      buildDetail({ kind: 'value', title: 'Prompt', value: 'x'.repeat(50_000) }, new Map()),
    )

    expect(detail.output[0]).toMatchObject({ bodyRef: 'n|out:0', bytes: 50_000 })
    expect(detail.output[0]?.preview).toHaveLength(20_000)
  })
})
