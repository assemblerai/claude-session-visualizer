import { BODY_SLICE_CHARS, type BodySlice, type NodeDetail, type SessionGraph } from '../../shared/session.js'
import { Refusal, SystemFailure } from '../errors.js'
import { buildDetail, parseBodyRef, toNodeDetail, type FullDetail } from './assemble/detail.js'
import { assemble, type Assembled } from './assemble/graph.js'
import type { HelperFiles } from './assemble/types.js'
import type { Disk } from './disk.js'
import { parseAgentMeta, parseLine, type AgentMeta, type ParsedTranscript } from './records.js'

/**
 * Loads sessions, keeps the last few assembled in memory with their bodies so
 * clicks are instant, and answers graph and detail queries
 * (docs/technical-design.md sections 2.1 and 7).
 *
 * A file is read from where the last read stopped, so a session that is still
 * running is extended, not re-read: asking for its graph again picks up
 * whatever was appended since.
 */

export interface SessionStore {
  graph(sessionId: string): Promise<SessionGraph>
  nodeDetail(sessionId: string, nodeId: string): Promise<NodeDetail>
  body(sessionId: string, bodyRef: string, offset: number): Promise<BodySlice>
}

interface OpenFile {
  path: string
  offset: number
  transcript: ParsedTranscript
}

interface SessionFilesOnDisk {
  main: OpenFile
  helpers: Map<string, { file: OpenFile; meta: AgentMeta; metaText: string }>
}

interface OpenSession extends SessionFilesOnDisk {
  assembled: Assembled
  details: Map<string, FullDetail>
}

const KEPT_SESSIONS = 3
const KEPT_DETAILS = 16

export function createSessionStore(disk: Disk, pathOf: (sessionId: string) => Promise<string>): SessionStore {
  const open = new Map<string, OpenSession>()
  const loading = new Map<string, Promise<OpenSession>>()

  /** Reads whatever the file has gained since the last read. True when it gained anything. */
  async function extend(file: OpenFile): Promise<boolean> {
    const { records, counts } = file.transcript
    const before = file.offset
    file.offset = await disk.forEachLine(file.path, file.offset, (line) => {
      if (line.trim() === '') return
      const parsed = parseLine(line)
      if (parsed.outcome === 'record') records.push(parsed.record)
      else if (parsed.outcome === 'ignored')
        counts.ignoredKinds[parsed.kind] = (counts.ignoredKinds[parsed.kind] ?? 0) + 1
      else if (parsed.outcome === 'unknown')
        counts.unknownKinds[parsed.kind] = (counts.unknownKinds[parsed.kind] ?? 0) + 1
      else counts.invalidLines += 1
    })
    return file.offset !== before
  }

  const newFile = (path: string): OpenFile => ({
    path,
    offset: 0,
    transcript: { records: [], counts: { unknownKinds: {}, ignoredKinds: {}, invalidLines: 0 } },
  })

  async function refresh(sessionId: string, known: OpenSession | undefined): Promise<OpenSession> {
    const session: SessionFilesOnDisk = known ?? { main: newFile(await pathOf(sessionId)), helpers: new Map() }

    let changed = known === undefined
    try {
      const size = (await disk.stat(session.main.path))?.size
      if (size === undefined)
        throw new Refusal(`The session file is no longer there: ${session.main.path}`, 'NOT_FOUND')
      if (size !== session.main.offset && (await extend(session.main))) changed = true

      for (const paths of await disk.listHelpers(session.main.path)) {
        const metaText = await disk.readText(paths.meta)
        let helper = session.helpers.get(paths.agentId)
        if (!helper) {
          const meta = parseAgentMeta(metaText)
          if (!meta) continue
          helper = { file: newFile(paths.transcript), meta, metaText }
          session.helpers.set(paths.agentId, helper)
          changed = true
        } else if (helper.metaText !== metaText) {
          // `finished` flips when the helper stops.
          helper.meta = parseAgentMeta(metaText) ?? helper.meta
          helper.metaText = metaText
          changed = true
        }
        if (await extend(helper.file)) changed = true
      }
    } catch (error) {
      if (error instanceof Refusal) throw error
      throw new SystemFailure('The session files could not be read.', { cause: error })
    }

    if (known && !changed) return known
    const helpers: HelperFiles[] = [...session.helpers].map(([agentId, h]) => ({
      agentId,
      meta: h.meta,
      transcript: h.file.transcript,
    }))
    return {
      ...session,
      assembled: assemble({ sessionId, main: session.main.transcript, helpers }),
      details: new Map(),
    }
  }

  /** The session, brought up to date with its files. One read at a time per session. */
  function current(sessionId: string): Promise<OpenSession> {
    const running = loading.get(sessionId)
    if (running) return running
    const load = refresh(sessionId, open.get(sessionId))
      .then((session) => {
        open.delete(sessionId)
        open.set(sessionId, session)
        for (const oldest of open.keys()) {
          if (open.size <= KEPT_SESSIONS) break
          open.delete(oldest)
        }
        return session
      })
      .finally(() => loading.delete(sessionId))
    loading.set(sessionId, load)
    return load
  }

  /** Clicks answer from memory: only `graph` goes back to the files. */
  async function opened(sessionId: string): Promise<OpenSession> {
    return open.get(sessionId) ?? current(sessionId)
  }

  function detailOf(session: OpenSession, nodeId: string): FullDetail {
    const known = session.details.get(nodeId)
    if (known) return known
    const source = session.assembled.sources.get(nodeId)
    if (!source) throw new Refusal(`No such node: ${nodeId}`, 'NOT_FOUND')
    const detail = buildDetail(source, session.assembled.requestIndexes)
    session.details.set(nodeId, detail)
    for (const oldest of session.details.keys()) {
      if (session.details.size <= KEPT_DETAILS) break
      session.details.delete(oldest)
    }
    return detail
  }

  return {
    graph: async (sessionId) => (await current(sessionId)).assembled.graph,

    async nodeDetail(sessionId, nodeId) {
      return toNodeDetail(nodeId, detailOf(await opened(sessionId), nodeId))
    },

    async body(sessionId, bodyRef, offset) {
      const ref = parseBodyRef(bodyRef)
      if (!ref) throw new Refusal(`No such body: ${bodyRef}`, 'NOT_FOUND')
      const detail = detailOf(await opened(sessionId), ref.nodeId)
      const full = (ref.side === 'in' ? detail.input : detail.output)[ref.i]
      if (!full) throw new Refusal(`No such body: ${bodyRef}`, 'NOT_FOUND')
      const end = offset + BODY_SLICE_CHARS
      return { text: full.text.slice(offset, end), nextOffset: end < full.text.length ? end : null }
    },
  }
}
