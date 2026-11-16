import type { Disk, HelperPaths } from './disk.js'
import { loadFixture, type FixtureName } from './fixtures.js'

/**
 * An in-memory `Disk` for specs: paths use `/`, files are strings, and a write
 * bumps the file's modified time.
 */
export interface FakeDisk extends Disk {
  files: Map<string, string>
  /** How many times each path was read by `forEachLine`. */
  reads: Map<string, number>
  append(path: string, text: string): void
}

const encoder = new TextEncoder()
const size = (text: string): number => encoder.encode(text).length

export function createFakeDisk(initial: Record<string, string> = {}): FakeDisk {
  const files = new Map(Object.entries(initial))
  const mtimes = new Map<string, number>()
  const reads = new Map<string, number>()
  let clock = 1_000
  const touch = (path: string): void => void mtimes.set(path, (clock += 1))
  for (const path of files.keys()) touch(path)

  const children = (dir: string): Map<string, boolean> => {
    const names = new Map<string, boolean>()
    for (const path of files.keys()) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name, ...rest] = path.slice(dir.length + 1).split('/')
      if (name) names.set(name, rest.length > 0 || names.get(name) === true)
    }
    return names
  }

  return {
    files,
    reads,
    append(path, text) {
      files.set(path, (files.get(path) ?? '') + text)
      touch(path)
    },
    async listProjects(root) {
      const names = children(root)
      if (names.size === 0) throw new Error(`ENOENT: ${root}`)
      return [...names].filter(([, isDir]) => isDir).map(([name]) => ({ name, path: `${root}/${name}` }))
    },
    async listSessions(projectPath) {
      return [...children(projectPath)]
        .filter(([name, isDir]) => !isDir && name.endsWith('.jsonl'))
        .map(([name]) => {
          const path = `${projectPath}/${name}`
          return {
            sessionId: name.slice(0, -'.jsonl'.length),
            path,
            size: size(files.get(path) ?? ''),
            mtimeMs: mtimes.get(path) ?? 0,
          }
        })
    },
    async listHelpers(mainPath) {
      const dir = `${mainPath.slice(0, -'.jsonl'.length)}/subagents`
      const helpers: HelperPaths[] = []
      for (const [name] of children(dir)) {
        const agentId = /^agent-(.+)\.jsonl$/.exec(name)?.[1]
        if (agentId && files.has(`${dir}/agent-${agentId}.meta.json`)) {
          helpers.push({ agentId, transcript: `${dir}/${name}`, meta: `${dir}/agent-${agentId}.meta.json` })
        }
      }
      return helpers
    },
    async stat(path) {
      const text = files.get(path)
      return text === undefined ? null : { size: size(text), mtimeMs: mtimes.get(path) ?? 0 }
    },
    async forEachLine(path, start, onLine) {
      const text = files.get(path)
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      reads.set(path, (reads.get(path) ?? 0) + 1)
      const bytes = encoder.encode(text).subarray(start)
      const end = bytes.lastIndexOf(0x0a)
      if (end === -1) return start
      for (const line of new TextDecoder().decode(bytes.subarray(0, end)).split('\n')) onLine(line)
      return start + end + 1
    },
    async readText(path) {
      const text = files.get(path)
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
    async writeText(path, text) {
      files.set(path, text)
      touch(path)
    },
  }
}

/** Lays a fixture out on a fake disk the way Claude Code lays out a session. */
export function fixtureOnDisk(
  name: FixtureName,
  projectPath: string,
  sessionId: string = name,
): Record<string, string> {
  const session = loadFixture(name)
  const files: Record<string, string> = { [`${projectPath}/${sessionId}.jsonl`]: session.main }
  for (const [agentId, helper] of Object.entries(session.helpers)) {
    files[`${projectPath}/${sessionId}/subagents/agent-${agentId}.jsonl`] = helper.transcript
    files[`${projectPath}/${sessionId}/subagents/agent-${agentId}.meta.json`] = helper.meta
  }
  return files
}
