import type { SessionGraph } from '@shared/session'

/** The scrubbed sessions, assembled, for the chart specs. */
const files = import.meta.glob<string>('./fixtures/*.graph.json', { query: '?raw', import: 'default', eager: true })

export type GraphFixture = 'plain' | 'one-helper' | 'nested'
export const GRAPH_FIXTURES: readonly GraphFixture[] = ['plain', 'one-helper', 'nested']

export function loadGraph(name: GraphFixture): SessionGraph {
  const text = files[`./fixtures/${name}.graph.json`]
  if (text === undefined) throw new Error(`no graph fixture ${name}`)
  return JSON.parse(text) as SessionGraph
}
