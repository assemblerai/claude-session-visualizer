import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Disk, FileStat, HelperPaths, ProjectDir, SessionFile } from './disk.js'
import { forEachLine } from './read-lines.js'

/** Roots → projects → session files (docs/technical-design.md section 1.1). Touches disk; kept thin. */

const SESSION_FILE = /^(.+)\.jsonl$/
const HELPER_FILE = /^agent-(.+)\.jsonl$/

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function statOrNull(path: string): Promise<FileStat | null> {
  try {
    const s = await stat(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function listProjects(root: string): Promise<ProjectDir[]> {
  const entries = await readdir(root, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, path: join(root, e.name) }))
}

async function listSessions(projectPath: string): Promise<SessionFile[]> {
  const entries = await readdir(projectPath, { withFileTypes: true })
  const files: SessionFile[] = []
  for (const entry of entries) {
    const sessionId = entry.isFile() ? SESSION_FILE.exec(entry.name)?.[1] : undefined
    if (sessionId === undefined) continue
    const path = join(projectPath, entry.name)
    const s = await statOrNull(path)
    if (s) files.push({ sessionId, path, ...s })
  }
  return files
}

async function listHelpers(mainPath: string): Promise<HelperPaths[]> {
  const dir = join(mainPath.replace(/\.jsonl$/, ''), 'subagents')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const present = new Set(names)
  const helpers: HelperPaths[] = []
  for (const name of names.sort()) {
    const agentId = HELPER_FILE.exec(name)?.[1]
    if (agentId === undefined || !present.has(`agent-${agentId}.meta.json`)) continue
    helpers.push({ agentId, transcript: join(dir, name), meta: join(dir, `agent-${agentId}.meta.json`) })
  }
  return helpers
}

export const disk: Disk = {
  listProjects,
  listSessions,
  listHelpers,
  stat: statOrNull,
  forEachLine,
  readText: (path) => readFile(path, 'utf8'),
  async writeText(path, text) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
  },
}
