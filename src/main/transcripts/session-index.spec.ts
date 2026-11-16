import { describe, expect, it } from 'vitest'
import type { Log } from '../diagnostics/log.js'
import { Refusal } from '../errors.js'
import { createFakeDisk, fixtureOnDisk, type FakeDisk } from './fake-disk.js'
import { createSessionIndex, type SessionIndex } from './session-index.js'

const log: Log = { write: () => undefined }
const PROJECT = '/root/-home-me-app'
const CACHE = '/userData/session-index.json'
const PLAIN = `${PROJECT}/plain.jsonl`
const HELPER = `${PROJECT}/one-helper.jsonl`

function setup(
  disk: FakeDisk = createFakeDisk({ ...fixtureOnDisk('plain', PROJECT), ...fixtureOnDisk('one-helper', PROJECT) }),
  imported: string[] = [HELPER, PLAIN],
): { disk: FakeDisk; index: SessionIndex } {
  return { disk, index: createSessionIndex({ disk, imported: async () => imported, cacheFile: CACHE, log }) }
}

describe('session index', () => {
  it('lists only the imported sessions, in import order', async () => {
    const { index } = setup(undefined, [PLAIN])

    await expect(index.list()).resolves.toEqual([expect.objectContaining({ sessionId: 'plain', path: PLAIN, project: '-home-me-app', missing: false })])
  })

  it('answers at once with pending rows, then fills them in', async () => {
    const { index } = setup()
    const first = await index.list()

    expect(first.map((s) => s.pending)).toEqual([true, true])
    await index.idle()
    const second = await index.list()
    const helper = second.find((s) => s.sessionId === 'one-helper')

    expect(second.every((s) => !s.pending && s.hasRequests)).toBe(true)
    expect(helper).toMatchObject({ helperCount: 1, costUsd: expect.closeTo(0.6569, 4) })
    expect(helper?.title).not.toBeNull()
    expect(helper?.endedAt).toBeGreaterThan(helper?.startedAt ?? Infinity)
  })

  it('does not re-read an unchanged file on a second launch', async () => {
    const { disk, index } = setup()
    await index.list()
    await index.idle()
    disk.reads.clear()

    const relaunched = setup(disk).index
    const rows = await relaunched.list()
    await relaunched.idle()

    expect(rows.every((s) => !s.pending)).toBe(true)
    expect(disk.reads.size).toBe(0)
  })

  it('re-reads a file that has changed', async () => {
    const { disk, index } = setup()
    await index.list()
    await index.idle()
    disk.reads.clear()
    disk.append(PLAIN, '{"type":"ai-title","aiTitle":"Renamed"}\n')

    await index.list()
    await index.idle()
    const rows = await index.list()

    expect([...disk.reads.keys()]).toEqual([PLAIN])
    expect(rows.find((s) => s.sessionId === 'plain')?.title).toBe('Renamed')
  })

  it('marks a session with no request records', async () => {
    const old = `${PROJECT}/old.jsonl`
    const { index } = setup(createFakeDisk({ [old]: '{"type":"user","uuid":"u","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hi"}}\n' }), [old])
    await index.list()
    await index.idle()

    expect((await index.list())[0]).toMatchObject({ hasRequests: false, startedAt: Date.parse('2026-01-01T00:00:00.000Z') })
  })

  it('keeps an imported session whose file has gone, marked missing', async () => {
    const { index } = setup(undefined, [`${PROJECT}/gone.jsonl`])

    expect((await index.list())[0]).toMatchObject({ sessionId: 'gone', missing: true, pending: false, hasRequests: false })
  })

  it('accepts a main session file and refuses anything else', async () => {
    const { index } = setup()

    await expect(index.checkImport([PLAIN])).resolves.toEqual([PLAIN])
    await expect(index.checkImport([`${PROJECT}/notes.txt`])).rejects.toBeInstanceOf(Refusal)
    await expect(index.checkImport([`${PROJECT}/one-helper/subagents/agent-ab264e6e0b102cad4.jsonl`])).rejects.toBeInstanceOf(Refusal)
    await expect(index.checkImport([`${PROJECT}/nope.jsonl`])).rejects.toBeInstanceOf(Refusal)
  })

  it('finds an imported session by id, and only an imported one', async () => {
    const { index } = setup(undefined, [PLAIN])

    await expect(index.pathOf('plain')).resolves.toBe(PLAIN)
    await expect(index.pathOf('one-helper')).rejects.toBeInstanceOf(Refusal)
  })
})
