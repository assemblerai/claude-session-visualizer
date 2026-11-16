import type { NodeKind } from '@shared/session'

/**
 * Chart colours. Canvas cannot read Tailwind classes, so the chart's palette
 * lives here; the surface and text values mirror the tokens in `index.css`.
 */
export const SURFACE = '#1c1c1e'
export const TEXT = '#e6e6e6'
export const TEXT_MUTED = '#9a9a9c'
export const EDGE = '#77777a'
export const ERROR = '#f87171'
export const SELECTED = '#ffffff'

/** One colour per node type (docs/plan.md, "Node types"). Never the only signal: each has a shape and an icon too. */
export const NODE_STYLE: Readonly<Record<NodeKind, { fill: string; line: string; icon: string; name: string }>> = {
  prompt: { fill: '#3a3a3d', line: '#8a8a8e', icon: '❯', name: 'Prompt' },
  result: { fill: '#3a3a3d', line: '#8a8a8e', icon: '✔', name: 'Result' },
  agent: { fill: '#4a2c1c', line: '#f08c4a', icon: '⚙', name: 'Agent' },
  request: { fill: '#3a2a5c', line: '#a78bfa', icon: '⇅', name: 'Anthropic request' },
  tool: { fill: '#1e3a5f', line: '#60a5fa', icon: '⚒', name: 'Tool' },
  'mcp-tool': { fill: '#12443f', line: '#2dd4bf', icon: '⊞', name: 'MCP tool' },
  context: { fill: '#2c2c2f', line: '#b8b8bc', icon: '✚', name: 'Context added' },
  compaction: { fill: '#3b1818', line: '#f87171', icon: '✂', name: 'Compaction' },
}

/**
 * Branch line colours: their own palette, apart from the node colours, so a
 * branch's colour is never mistaken for a node type. Index 0 is the trunk.
 */
export const BRANCH_COLOURS: readonly string[] = [
  '#d4d4d8',
  '#f472b6',
  '#a3e635',
  '#38bdf8',
  '#fbbf24',
  '#c084fc',
  '#fb7185',
  '#34d399',
  '#f97316',
  '#818cf8',
  '#e879f9',
  '#facc15',
]

export function branchColour(agentIndex: number): string {
  if (agentIndex <= 0) return BRANCH_COLOURS[0] as string
  return BRANCH_COLOURS[1 + ((agentIndex - 1) % (BRANCH_COLOURS.length - 1))] as string
}
