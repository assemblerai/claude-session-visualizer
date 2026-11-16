import { describe, expect, it } from 'vitest'
import { FIXTURE_NAMES, loadFixture } from './fixtures.js'
import { isToolResult, isToolUse, parseAgentMeta, parseLine, parseTranscript } from './records.js'

describe('parseTranscript, on the fixtures', () => {
  it.each(FIXTURE_NAMES)('reads every line of %s as a known kind', (name) => {
    const session = loadFixture(name)
    const texts = [session.main, ...Object.values(session.helpers).map((h) => h.transcript)]

    for (const text of texts) {
      const { records, counts } = parseTranscript(text)
      expect(records.length).toBeGreaterThan(0)
      expect(counts.unknownKinds).toEqual({})
      expect(counts.invalidLines).toBe(0)
    }
  })

  it.each(FIXTURE_NAMES)('reads every helper label file of %s', (name) => {
    for (const helper of Object.values(loadFixture(name).helpers)) {
      expect(parseAgentMeta(helper.meta)?.toolUseId).toMatch(/^toolu_/)
    }
  })

  it('finds the helpers of each fixture', () => {
    expect(Object.keys(loadFixture('plain').helpers)).toHaveLength(0)
    expect(Object.keys(loadFixture('one-helper').helpers)).toHaveLength(1)
    expect(Object.keys(loadFixture('nested').helpers)).toHaveLength(2)
  })

  it('pairs every tool result in a fixture with a tool request', () => {
    const { records } = parseTranscript(loadFixture('one-helper').main)
    const asked = new Set<string>()
    const answered: string[] = []
    for (const record of records) {
      if (record.type === 'assistant') for (const b of record.message.content) if (isToolUse(b)) asked.add(b.id)
      if (record.type === 'user' && Array.isArray(record.message.content))
        for (const b of record.message.content) if (isToolResult(b)) answered.push(b.tool_use_id)
    }

    expect(answered.length).toBeGreaterThan(0)
    expect(answered.every((id) => asked.has(id))).toBe(true)
  })
})

describe('parseTranscript, on odd lines', () => {
  it('counts a kind it has never seen, by name', () => {
    const { records, counts } = parseTranscript('{"type":"brand-new-kind","x":1}\n{"type":"brand-new-kind"}\n')

    expect(records).toEqual([])
    expect(counts.unknownKinds).toEqual({ 'brand-new-kind': 2 })
  })

  it('counts a kind it ignores on purpose', () => {
    expect(parseTranscript('{"type":"last-prompt","lastPrompt":"x"}').counts.ignoredKinds).toEqual({ 'last-prompt': 1 })
  })

  it('counts a line that is not JSON, and keeps reading', () => {
    const title = '{"type":"ai-title","aiTitle":"A title"}'
    const { records, counts } = parseTranscript(`{"type":"user", "mess\n${title}\n`)

    expect(counts.invalidLines).toBe(1)
    expect(records).toEqual([{ type: 'ai-title', aiTitle: 'A title' }])
  })

  it('counts a record that does not fit its kind', () => {
    expect(parseLine('{"type":"api-request-blob","hash":7}')).toEqual({ outcome: 'invalid' })
  })

  it('counts a line with no type', () => {
    expect(parseLine('{"uuid":"1"}')).toEqual({ outcome: 'invalid' })
    expect(parseLine('42')).toEqual({ outcome: 'invalid' })
  })

  it('skips blank lines', () => {
    expect(parseTranscript('\n\n  \n').counts.invalidLines).toBe(0)
  })
})

describe('parseLine, on request records', () => {
  it('reads a first request, which has no base', () => {
    const parsed = parseLine('{"type":"api-request","id":"r1","timestamp":"2026-11-15T00:00:00.000Z","tail":["aa"]}')

    expect(parsed).toMatchObject({ outcome: 'record', record: { id: 'r1', keep: 0, tail: ['aa'] } })
  })

  it('lets a field it does not know through', () => {
    const parsed = parseLine('{"type":"ai-title","aiTitle":"T","somethingNew":true}')

    expect(parsed).toMatchObject({ outcome: 'record', record: { somethingNew: true } })
  })
})

describe('parseAgentMeta', () => {
  it('reads a helper started by the main agent', () => {
    const meta = parseAgentMeta('{"agentType":"coder-react","description":"Build it","toolUseId":"toolu_1"}')

    expect(meta).toMatchObject({ agentType: 'coder-react', spawnDepth: 1, requestShape: 'foreground', finished: false })
    expect(meta?.parentAgentId).toBeUndefined()
  })

  it('answers null for text that is not a label file', () => {
    expect(parseAgentMeta('not json')).toBeNull()
    expect(parseAgentMeta('{"agentType":"x"}')).toBeNull()
  })
})
