import { describe, expect, it } from 'vitest'
import { FIXTURE_NAMES, loadFixtureFiles } from '../fixtures.js'
import { parseTranscript } from '../records.js'
import { canonicalJson, fingerprint, indexRequests } from './requests.js'

const line = (value: unknown): string => JSON.stringify(value)
const request = (id: string, tail: string[], base?: string, keep = 0): string =>
  line({ type: 'api-request', id, timestamp: '2026-11-15T00:00:00.000Z', tail, ...(base ? { base, keep } : {}) })

describe('canonicalJson', () => {
  it('sorts keys, drops whitespace and leaves non-ASCII as written', () => {
    expect(canonicalJson({ b: 1, a: { d: 'é', c: [true, null] } })).toBe('{"a":{"c":[true,null],"d":"é"},"b":1}')
  })
})

describe('indexRequests, on the fixtures', () => {
  it.each(FIXTURE_NAMES)('resolves every fingerprint of %s', (name) => {
    const files = loadFixtureFiles(name)
    for (const transcript of [files.main, ...files.helpers.map((h) => h.transcript)]) {
      const index = indexRequests(transcript.records)

      expect(index.requests.length).toBeGreaterThan(0)
      expect(index.unresolved).toEqual([])
      for (const r of index.requests) {
        expect(index.shape(r.shapeHash)).toBeDefined()
        for (const hash of index.fingerprints(r.id)) expect(index.resolve(hash)).toBeDefined()
      }
    }
  })

  it('finds some messages in the transcript itself, with no blob', () => {
    const { records } = loadFixtureFiles('nested').main
    const blobs = new Set(records.flatMap((r) => (r.type === 'api-request-blob' ? [r.hash] : [])))
    const index = indexRequests(records)
    const tails = index.requests.flatMap((r) => r.tail)

    expect(tails.some((h) => !blobs.has(h))).toBe(true)
  })
})

describe('indexRequests, on a chain', () => {
  const records = parseTranscript(
    [request('r1', ['a', 'b', 'c']), request('r2', ['d'], 'r1', 3), request('r3', ['e'], 'r2', 2)].join('\n'),
  ).records
  const index = indexRequests(records)

  it('keeps the base, then adds the tail', () => {
    expect(index.fingerprints('r2')).toEqual(['a', 'b', 'c', 'd'])
    expect(index.kept('r2')).toBe(3)
  })

  it('handles a keep shorter than the base: earlier messages were rewritten', () => {
    expect(index.fingerprints('r3')).toEqual(['a', 'b', 'e'])
    expect(index.kept('r3')).toBe(2)
  })

  it('treats a first request as all new', () => {
    expect(index.kept('r1')).toBe(0)
  })

  it('reports a fingerprint nothing resolves, and never guesses it', () => {
    expect(index.resolve('a')).toBeUndefined()
    expect([...index.unresolved].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('indexRequests, on a request written out in full', () => {
  const records = parseTranscript(
    [
      request('r1', ['a', 'b']),
      request('r2', ['c'], 'r1', 2),
      request('r3', ['a', 'b', 'c', 'd', 'e']),
      request('r4', ['x', 'y']),
    ].join('\n'),
  ).records
  const index = indexRequests(records)

  it('counts what it shares with the previous request as carried over, though it has no base', () => {
    expect(index.fingerprints('r3')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(index.kept('r3')).toBe(3)
  })

  it('counts nothing as carried over when the previous request shares no opening messages', () => {
    expect(index.kept('r4')).toBe(0)
  })

  it('compares only with requests of the same querySource', () => {
    const mixed = indexRequests(
      parseTranscript(
        [
          line({
            type: 'api-request',
            id: 'm1',
            timestamp: '2026-11-15T00:00:00.000Z',
            querySource: 'sdk',
            tail: ['a'],
          }),
          line({
            type: 'api-request',
            id: 's1',
            timestamp: '2026-11-15T00:00:00.000Z',
            querySource: 'title',
            tail: ['t'],
          }),
          line({
            type: 'api-request',
            id: 'm2',
            timestamp: '2026-11-15T00:00:00.000Z',
            querySource: 'sdk',
            tail: ['a', 'b'],
          }),
        ].join('\n'),
      ).records,
    )
    expect(mixed.kept('m2')).toBe(1)
    expect(mixed.kept('s1')).toBe(0)
  })
})

describe('indexRequests, resolving from the transcript', () => {
  const user = (uuid: string, content: unknown): string =>
    line({ type: 'user', uuid, timestamp: '2026-11-15T00:00:00.000Z', message: { role: 'user', content } })
  const assistant = (uuid: string, content: unknown[]): string =>
    line({
      type: 'assistant',
      uuid,
      timestamp: '2026-11-15T00:00:00.000Z',
      message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-5-5', content },
    })
  const result = (id: string): unknown => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })

  it('uses each of the four rules', () => {
    const think = { type: 'thinking', thinking: 'hm' }
    const call = { type: 'tool_use', id: 't1', name: 'Read', input: {} }
    const wanted = [
      fingerprint({ role: 'user', content: [{ type: 'text', text: 'hello' }] }), // 4: a string prompt as one text block
      fingerprint({ role: 'assistant', content: [think, call] }), // 2: one reply's records merged
      fingerprint({ role: 'user', content: [result('t1'), result('t2')] }), // 3: a run of tool results merged
      fingerprint({ role: 'user', content: 'again' }), // 1: one record as written
    ]
    const text = [
      user('u1', 'hello'),
      assistant('a1', [think]),
      assistant('a2', [call]),
      user('u2', [result('t1')]),
      user('u3', [result('t2')]),
      user('u4', 'again'),
      request('r1', wanted),
    ].join('\n')

    expect(indexRequests(parseTranscript(text).records).unresolved).toEqual([])
  })
})
