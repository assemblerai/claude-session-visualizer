/// <reference types="vite/client" />
import type { HelperFiles, SessionFiles } from './assemble/types.js'
import { parseAgentMeta, parseTranscript } from './records.js'

/**
 * The scrubbed sessions under `fixtures/`, as text. Specs import this, not
 * `node:fs`: the bundler inlines the files.
 */
const files = import.meta.glob<string>('./fixtures/*/*', { query: '?raw', import: 'default', eager: true })

export type FixtureName = 'plain' | 'one-helper' | 'nested'
export const FIXTURE_NAMES: readonly FixtureName[] = ['plain', 'one-helper', 'nested']

export interface FixtureSession {
  /** The main conversation's `.jsonl` text. */
  main: string
  /** One entry per helper, keyed by agent id. */
  helpers: Record<string, { transcript: string; meta: string }>
}

export function loadFixture(name: FixtureName): FixtureSession {
  const prefix = `./fixtures/${name}/`
  const session: FixtureSession = { main: files[`${prefix}main.jsonl`] ?? '', helpers: {} }
  for (const [path, text] of Object.entries(files)) {
    const match = path.startsWith(prefix) ? /^agent-([0-9a-f]+)\.jsonl$/.exec(path.slice(prefix.length)) : null
    const agentId = match?.[1]
    if (agentId === undefined) continue
    session.helpers[agentId] = { transcript: text, meta: files[`${prefix}agent-${agentId}.meta.json`] ?? '' }
  }
  return session
}

/** A fixture, parsed: what `assemble` takes. */
export function loadFixtureFiles(name: FixtureName): SessionFiles {
  const session = loadFixture(name)
  const helpers: HelperFiles[] = []
  for (const [agentId, helper] of Object.entries(session.helpers)) {
    const meta = parseAgentMeta(helper.meta)
    if (meta) helpers.push({ agentId, meta, transcript: parseTranscript(helper.transcript) })
  }
  return { sessionId: name, main: parseTranscript(session.main), helpers }
}
