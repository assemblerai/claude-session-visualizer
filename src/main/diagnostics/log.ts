import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

export interface Log {
  write(level: LogLevel, message: string, error?: unknown): void
}

/** A log line, without the trailing newline. One line per entry, so the file stays greppable. */
export function formatLine(at: Date, level: LogLevel, message: string): string {
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${message.replace(/\r?\n/g, ' ')}`
}

/** What a caught value contributes to a line. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/** Appends to `file` and mirrors to the console. Never throws: logging must not be what fails. */
export function createLog(file: string): Log {
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    // Falls back to console only.
  }

  return {
    write(level, message, error) {
      const line = formatLine(new Date(), level, error === undefined ? message : `${message}: ${describeError(error)}`)
      if (level === 'error') console.error(line)
      else console.log(line)
      try {
        appendFileSync(file, `${line}\n`, 'utf8')
      } catch {
        // Console already has it.
      }
    },
  }
}
