import { describe, expect, it } from 'vitest'
import { Refusal } from '../errors.js'
import { createFakeDisk, fixtureOnDisk, type FakeDisk } from './fake-disk.js'
import { loadFixture } from './fixtures.js'
import { createSessionStore, type SessionStore } from './session-store.js'

const PROJECT = '/root/p'

function setup(files: Record<string, string>): { disk: FakeDisk; store: SessionStore } {
  const disk = createFakeDisk(files)
  const store = createSessionStore(disk, async (sessionId) => {
    const path = `${PROJECT}/${sessionId}.jsonl`
    if (!disk.files.has(path)) throw new Refusal('no such session', 'NOT_FOUND')
    return path
  })
  return { disk, store }
}

describe('session store', () => {
  it('assembles a session with its helpers from disk', async () => {
    const { store } = setup(fixtureOnDisk('nested', PROJECT))
    const graph = await store.graph('nested')

    expect(graph.agents.map((a) => a.id)).toEqual(['main', 'a440e649178b9695b', 'a3f9dfe69c9529450'])
    expect(graph.nodes.some((n) => 'body' in n || 'input' in n)).toBe(false)
  })

  it('does not read an unchanged session again', async () => {
    const { disk, store } = setup(fixtureOnDisk('one-helper', PROJECT))
    const first = await store.graph('one-helper')
    disk.reads.clear()

    expect(await store.graph('one-helper')).toBe(first)
    expect(disk.reads.get(`${PROJECT}/one-helper.jsonl`)).toBeUndefined()
  })

  it("answers a node's bodies, and pages one too large to send whole", async () => {
    const { store } = setup(fixtureOnDisk('one-helper', PROJECT))
    const graph = await store.graph('one-helper')
    const request = graph.nodes.filter((n) => n.kind === 'request')[1]
    const detail = await store.nodeDetail('one-helper', request?.id ?? '')
    const tools = detail.input.find((b) => b.role === 'tools')

    expect(tools?.bodyRef).not.toBeNull()
    const slice = await store.body('one-helper', tools?.bodyRef ?? '', 0)
    expect(slice.text.startsWith(tools?.preview ?? 'x')).toBe(true)
    expect(slice.text.length).toBeGreaterThan(tools?.preview.length ?? Infinity)
  })

  it('refuses a node or body that is not there', async () => {
    const { store } = setup(fixtureOnDisk('plain', PROJECT))
    await store.graph('plain')

    await expect(store.nodeDetail('plain', 'req:nope')).rejects.toBeInstanceOf(Refusal)
    await expect(store.body('plain', 'garbage', 0)).rejects.toBeInstanceOf(Refusal)
    await expect(store.graph('missing')).rejects.toBeInstanceOf(Refusal)
  })

  it('refuses a session with no request records', async () => {
    const { store } = setup({ [`${PROJECT}/old.jsonl`]: '{"type":"user","uuid":"u","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"hi"}}\n' })

    await expect(store.graph('old')).rejects.toThrow(/no request records/)
  })

  it('extends a session that is still running, reading only what was added', async () => {
    const lines = loadFixture('plain').main.split('\n').filter((l) => l !== '')
    const cut = lines.findIndex((l, i) => i > 25 && l.includes('"type":"user"'))
    const { disk, store } = setup({ [`${PROJECT}/live.jsonl`]: `${lines.slice(0, cut).join('\n')}\n` })
    const before = await store.graph('live')

    // A line still being written is left for the next read.
    disk.append(`${PROJECT}/live.jsonl`, `${lines.slice(cut).join('\n')}\n{"type":"ai-ti`)
    const after = await store.graph('live')

    expect(after.nodes.length).toBeGreaterThan(before.nodes.length)
    expect(after.nodes.slice(0, 5).map((n) => n.id)).toEqual(before.nodes.slice(0, 5).map((n) => n.id))
    expect(after.totals.requests).toBe(5)
    expect(after.warnings).toEqual([])
  })
})
