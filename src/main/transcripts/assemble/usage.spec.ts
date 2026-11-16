import { describe, expect, it } from 'vitest'
import { loadFixtureFiles } from '../fixtures.js'
import { parseTranscript } from '../records.js'
import { collectReplies, isSynthetic } from './usage.js'

const part = (uuid: string, output: number, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: `2026-11-15T00:00:0${uuid}.000Z`,
    requestRef: 'r1',
    message: {
      id: 'msg_1',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: uuid }],
      usage: {
        input_tokens: 3,
        output_tokens: output,
        cache_read_input_tokens: 10,
        cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 5 },
      },
    },
    ...extra,
  })

describe('collectReplies', () => {
  it('counts a reply split over three lines once, using the last line', () => {
    const replies = collectReplies(parseTranscript([part('1', 20), part('2', 20), part('3', 55)].join('\n')).records)

    expect(replies).toHaveLength(1)
    expect(replies[0]?.usage).toEqual({ input: 3, output: 55, cacheRead: 10, cacheWrite5m: 4, cacheWrite1h: 5 })
    expect(replies[0]?.content).toHaveLength(3)
    expect(replies[0]?.lastAt).toBeGreaterThan(replies[0]?.firstAt ?? 0)
  })

  it('knows a message Claude Code wrote itself: no request, no cost', () => {
    const text = JSON.stringify({
      type: 'assistant',
      uuid: 's',
      timestamp: '2026-11-15T00:00:00.000Z',
      message: { id: 'x', role: 'assistant', model: '<synthetic>', content: [] },
    })
    const [reply] = collectReplies(parseTranscript(text).records)

    expect(reply && isSynthetic(reply)).toBe(true)
  })

  it('finds one reply per request in a fixture', () => {
    const { records } = loadFixtureFiles('plain').main
    const answered = collectReplies(records).filter((r) => !isSynthetic(r))

    expect(new Set(answered.map((r) => r.requestRef)).size).toBe(answered.length)
    expect(answered).toHaveLength(5)
  })
})
