import type { FileTouch } from '../../../shared/session.js'
import { isObject } from './types.js'

/**
 * Tool adapters for the Files screen (docs/technical-design.md section 10).
 * A tool's result is opaque, so "which file" comes from knowing which input
 * field is the path. Built-ins and the `dev-tools` file tools, to start with.
 */
const ADAPTERS: Readonly<Record<string, { field: string; action: FileTouch['action'] }>> = {
  Read: { field: 'file_path', action: 'read' },
  Edit: { field: 'file_path', action: 'edit' },
  MultiEdit: { field: 'file_path', action: 'edit' },
  Write: { field: 'file_path', action: 'write' },
  NotebookEdit: { field: 'notebook_path', action: 'edit' },
  'mcp__dev-tools__read_file': { field: 'path', action: 'read' },
  'mcp__dev-tools__edit_file': { field: 'path', action: 'edit' },
  'mcp__dev-tools__write_file': { field: 'path', action: 'write' },
  'mcp__dev-tools__delete_file': { field: 'path', action: 'delete' },
  'mcp__dev-tools__copy_file': { field: 'dst', action: 'write' },
}

/** The file a tool request touched, or `undefined` for a tool with no adapter. */
export function fileTouchOf(toolName: string, input: unknown): FileTouch | undefined {
  const adapter = Object.hasOwn(ADAPTERS, toolName) ? ADAPTERS[toolName] : undefined
  if (!adapter || !isObject(input)) return undefined
  const path = input[adapter.field]
  return typeof path === 'string' && path !== '' ? { path, action: adapter.action } : undefined
}

/** The `server` part of `mcp__<server>__<tool>`, or null for a built-in tool. */
export function mcpServerOf(toolName: string): string | null {
  if (!toolName.startsWith('mcp__')) return null
  return toolName.split('__')[1] ?? null
}
