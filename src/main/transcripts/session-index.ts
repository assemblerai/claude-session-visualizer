import type { SessionSummary } from '../../shared/session.js'
import type { Log } from '../diagnostics/log.js'
import { Refusal } from '../errors.js'
import type { Disk, SessionFile } from './disk.js'

/**
 * The session list and its on-disk cache (docs/technical-design.md section 7).
 * A row needs the file read once, and the files total gigabytes, so rows are
 * cached by path with size and modified time, and listing never waits for a
 * read: uncached rows come back `pending` and are filled in behind. Only the
 * sessions the person imported are listed; nothing scans the projects folders.
 */

type Row = Pick<SessionSummary, 'title' | 'startedAt' | 'endedAt' | 'helperCount' | 'costUsd' | 'hasRequests'>

interface CachedRow extends Row {
  size: number
  mtimeMs: number
}

const TIMESTAMP = /"timestamp":"(\d{4}-\d{2}-\d{2}T[^"]+)"/

/** Reads the cheap fields off a session file's lines, parsing only the few that matter. */
export function createSummarizer(): { line(line: string): void; done(helperCount: number): Row } {
  let title: string | null = null
  let startedAt: number | null = null
  let endedAt: number | null = null
  let costUsd: number | null = null
  let hasRequests = false

  const parsed = (line: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(line) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return {
    line(line) {
      const stamp = TIMESTAMP.exec(line)?.[1]
      const at = stamp === undefined ? Number.NaN : Date.parse(stamp)
      if (!Number.isNaN(at)) {
        startedAt = startedAt === null ? at : Math.min(startedAt, at)
        endedAt = endedAt === null ? at : Math.max(endedAt, at)
      }
      if (!hasRequests && line.includes('"type":"api-request"')) hasRequests = true
      if (line.includes('"type":"ai-title"')) {
        const record = parsed(line)
        if (record?.type === 'ai-title' && typeof record.aiTitle === 'string') title = record.aiTitle
      } else if (line.includes('"type":"cost-state"')) {
        const record = parsed(line)
        if (record?.type === 'cost-state' && typeof record.totalCostUSD === 'number') costUsd = record.totalCostUSD
      }
    },
    done: (helperCount) => ({ title, startedAt, endedAt, helperCount, costUsd, hasRequests }),
  }
}

/** The last part of a path, whichever separator it uses. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The folder a path sits in, by name. */
function parentName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 2] ?? ''
}

export function sessionIdOf(path: string): string {
  return baseName(path).replace(/\.jsonl$/, '')
}

export interface SessionIndex {
  /** One row per imported session. Rows not read yet come back `pending`. */
  list(): Promise<SessionSummary[]>
  /** Refuses a file that is not a session's main `.jsonl`; answers the paths that are. */
  checkImport(paths: string[]): Promise<string[]>
  /** The path of an imported session's main file. Refuses when none was imported with that id. */
  pathOf(sessionId: string): Promise<string>
  /** Resolves when nothing is left to read. For specs and shutdown. */
  idle(): Promise<void>
}

export interface SessionIndexOptions {
  disk: Disk
  /** The imported sessions' main files. */
  imported: () => Promise<string[]>
  cacheFile: string
  log: Log
}

export function createSessionIndex({ disk, imported, cacheFile, log }: SessionIndexOptions): SessionIndex {
  let cache: Map<string, CachedRow> | null = null
  const queued = new Set<string>()
  let worker: Promise<void> = Promise.resolve()
  let unsaved = 0

  async function loadCache(): Promise<Map<string, CachedRow>> {
    if (cache) return cache
    try {
      const saved = JSON.parse(await disk.readText(cacheFile)) as { rows?: Record<string, CachedRow> }
      cache = new Map(Object.entries(saved.rows ?? {}))
    } catch {
      cache = new Map()
    }
    return cache
  }

  async function saveCache(): Promise<void> {
    if (!cache || unsaved === 0) return
    unsaved = 0
    try {
      await disk.writeText(cacheFile, JSON.stringify({ rows: Object.fromEntries(cache) }))
    } catch (error) {
      log.write('warn', 'session index: could not save the cache', error)
    }
  }

  function enqueue(file: SessionFile): void {
    if (queued.has(file.path)) return
    queued.add(file.path)
    worker = worker.then(async () => {
      try {
        const summarizer = createSummarizer()
        await disk.forEachLine(file.path, 0, summarizer.line)
        const helpers = await disk.listHelpers(file.path)
        ;(await loadCache()).set(file.path, {
          ...summarizer.done(helpers.length),
          size: file.size,
          mtimeMs: file.mtimeMs,
        })
        unsaved += 1
      } catch (error) {
        log.write('warn', `session index: could not read ${file.path}`, error)
      } finally {
        queued.delete(file.path)
        if (queued.size === 0 || unsaved >= 25) await saveCache()
      }
    })
  }

  const EMPTY: Row = { title: null, startedAt: null, endedAt: null, helperCount: 0, costUsd: null, hasRequests: true }

  return {
    async list() {
      const rows = await loadCache()
      const summaries: SessionSummary[] = []
      for (const path of await imported()) {
        const sessionId = sessionIdOf(path)
        const s = await disk.stat(path)
        const known = rows.get(path)
        if (s !== null && !(known !== undefined && known.size === s.size && known.mtimeMs === s.mtimeMs))
          enqueue({ sessionId, path, ...s })
        const row: Row = known ?? EMPTY
        summaries.push({
          sessionId,
          path,
          project: parentName(path),
          missing: s === null,
          modifiedAt: s?.mtimeMs ?? known?.mtimeMs ?? 0,
          sizeBytes: s?.size ?? 0,
          // A stale row is still shown while the file is re-read.
          pending: s !== null && known === undefined,
          title: row.title,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          helperCount: row.helperCount,
          costUsd: row.costUsd,
          hasRequests: s !== null && row.hasRequests,
        })
      }
      return summaries
    },

    async checkImport(paths) {
      for (const path of paths) {
        const name = baseName(path)
        if (!name.endsWith('.jsonl'))
          throw new Refusal(`${name} is not a session file: pick a .jsonl file from a project folder.`)
        if (name.startsWith('agent-') || parentName(path) === 'subagents') {
          throw new Refusal(
            `${name} is a helper's transcript. Import the session's main .jsonl from the project folder instead; its helpers come with it.`,
          )
        }
        if ((await disk.stat(path)) === null) throw new Refusal(`${path} could not be found.`, 'NOT_FOUND')
      }
      return paths
    },

    async pathOf(sessionId) {
      const found = (await imported()).find((path) => sessionIdOf(path) === sessionId)
      if (!found) throw new Refusal(`Session ${sessionId} has not been imported.`, 'NOT_FOUND')
      return found
    },

    idle: () => worker,
  }
}
