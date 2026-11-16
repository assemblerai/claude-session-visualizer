/**
 * Everything the transcript code asks of the filesystem, as one interface.
 * `locate.ts` and `read-lines.ts` implement it; specs pass a fake, since a
 * unit test never touches the filesystem.
 */

export interface FileStat {
  size: number
  mtimeMs: number
}

export interface ProjectDir {
  /** The folder name: the project's path with slashes turned into dashes. */
  name: string
  path: string
}

export interface SessionFile extends FileStat {
  sessionId: string
  path: string
}

export interface HelperPaths {
  agentId: string
  transcript: string
  meta: string
}

export interface Disk {
  /** The project folders under a root. Rejects when the root cannot be read. */
  listProjects(root: string): Promise<ProjectDir[]>
  /** The `<sessionId>.jsonl` files directly in a project folder. */
  listSessions(projectPath: string): Promise<SessionFile[]>
  /** A session's helper files, given the path of its main `.jsonl`. Empty when it has none. */
  listHelpers(mainPath: string): Promise<HelperPaths[]>
  /** `null` when the file is not there. */
  stat(path: string): Promise<FileStat | null>
  /**
   * Calls `onLine` for every complete line from byte `start`, and answers the
   * offset just past the last one. A last line with no newline yet is left for
   * the next read: it is still being written.
   */
  forEachLine(path: string, start: number, onLine: (line: string) => void): Promise<number>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
}
