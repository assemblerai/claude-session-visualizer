import type { SessionGraph } from '@shared/session'
import { byFile } from '../breakdowns'
import { formatClock } from '../format'

interface FilesViewProps {
  graph: SessionGraph
  selectedId: string | null
  onSelect: (nodeId: string) => void
}

/** Every file read or changed, which agent touched it, and — through the details panel — what changed. */
export function FilesView({ graph, selectedId, onSelect }: FilesViewProps): React.JSX.Element {
  const rows = byFile(graph)
  const agents = new Map(graph.agents.map((a) => [a.id, a.id === 'main' ? 'main' : a.type]))

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted">
        No file reads or changes were recognised in this session. File tools from other add-on servers are not read yet.
      </p>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const changed = row.counts.edit + row.counts.write + row.counts.delete
          return (
            <li key={row.path}>
              <details className="rounded border border-line">
                <summary className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs [direction:rtl] text-left"
                    title={row.path}
                  >
                    <bdi>{row.path}</bdi>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {row.counts.read > 0 && `read ${row.counts.read}× `}
                    {changed > 0 && <span className="text-warning">changed {changed}× </span>}
                  </span>
                  <span
                    className="max-w-[35%] shrink-0 truncate text-xs text-subtle"
                    title={`${row.agentIds.length} agents`}
                  >
                    {[...new Set(row.agentIds.map((id) => agents.get(id) ?? id))].join(', ')}
                  </span>
                </summary>
                <ul className="border-t border-line">
                  {row.touches.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(node.id)}
                        className={`flex w-full items-center gap-3 px-3 py-1 text-left text-xs hover:bg-surface-raised ${node.id === selectedId ? 'bg-surface-raised' : ''}`}
                      >
                        <span className="w-20 shrink-0 text-muted">{formatClock(node.startedAt)}</span>
                        <span className="w-14 shrink-0">{node.tool?.file?.action}</span>
                        <span className="w-40 shrink-0 truncate text-muted">
                          {agents.get(node.agentId) ?? node.agentId}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-subtle">{node.tool?.name}</span>
                        {node.error && <span className="text-danger">failed</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
