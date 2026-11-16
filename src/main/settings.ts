import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Disk } from './transcripts/disk.js'

/**
 * What is saved under userData: the `.claude/projects` folders detected on
 * first run (where the import dialog opens), and the session files the person
 * has imported. Only imported sessions are listed and read.
 */
export interface Settings {
  getRoots(): Promise<string[]>
  /** The main `.jsonl` paths of the imported sessions, most recent import first. */
  getImported(): Promise<string[]>
  /** Adds paths, moving any already there to the front. */
  addImported(paths: string[]): Promise<string[]>
  removeImported(path: string): Promise<string[]>
}

function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    // `wsl.exe -l -q` prints UTF-16.
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', timeout: 5_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve([])
      const names = stdout
        .toString('utf16le')
        .split(/\r?\n/)
        .map((line) => line.replace(/\0/g, '').trim())
      resolve(names.filter((name) => name !== ''))
    })
  })
}

/** Every `.claude/projects` this machine has: the Windows home, and each WSL distro's users. */
export async function detectRoots(disk: Disk, platform: NodeJS.Platform = process.platform): Promise<string[]> {
  const candidates = [join(homedir(), '.claude', 'projects')]
  if (platform === 'win32') {
    for (const distro of await wslDistros()) {
      const home = `\\\\wsl.localhost\\${distro}\\home`
      try {
        for (const user of await disk.listProjects(home)) candidates.push(join(user.path, '.claude', 'projects'))
      } catch {
        // A distro that is stopped or has no /home is not a root.
      }
    }
  }
  const found: string[] = []
  for (const candidate of candidates) {
    try {
      await disk.listProjects(candidate)
      found.push(candidate)
    } catch {
      // Not there.
    }
  }
  return found
}

function cleanPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const paths = value.filter((r): r is string => typeof r === 'string').map((r) => r.trim())
  return [...new Set(paths.filter((r) => r !== ''))]
}

interface Saved {
  roots: string[]
  imported: string[]
}

export function createSettings(file: string, disk: Disk, detect: () => Promise<string[]> = () => detectRoots(disk)): Settings {
  let state: Saved | null = null

  async function save(next: Saved): Promise<Saved> {
    state = next
    await disk.writeText(file, `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  async function load(): Promise<Saved> {
    if (state) return state
    let saved: { roots?: unknown; imported?: unknown } = {}
    try {
      saved = JSON.parse(await disk.readText(file)) as typeof saved
    } catch {
      // First run, or a settings file that cannot be read: start again.
    }
    const roots = cleanPaths(saved.roots)
    const imported = cleanPaths(saved.imported) ?? []
    if (roots) return (state = { roots, imported })
    return save({ roots: await detect(), imported })
  }

  return {
    getRoots: async () => (await load()).roots,
    getImported: async () => (await load()).imported,
    async addImported(paths) {
      const current = await load()
      const added = cleanPaths(paths) ?? []
      return (await save({ ...current, imported: [...added, ...current.imported.filter((p) => !added.includes(p))] })).imported
    },
    async removeImported(path) {
      const current = await load()
      return (await save({ ...current, imported: current.imported.filter((p) => p !== path) })).imported
    },
  }
}
