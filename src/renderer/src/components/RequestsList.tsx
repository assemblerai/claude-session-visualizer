import type { SessionGraph } from '@shared/session'
import { formatClock, formatCost, formatCount, formatDuration } from '../format'

interface ScreenProps {
  graph: SessionGraph
  selectedId: string | null
  onSelect: (nodeId: string) => void
}

/** Every request sent to Anthropic, in order. Clicking one opens it in the details panel. */
export function RequestsList({ graph, selectedId, onSelect }: ScreenProps): React.JSX.Element {
  const agents = new Map(graph.agents.map((a) => [a.id, a.id === 'main' ? 'main' : a.type]))
  const requests = graph.nodes.filter((n) => n.kind === 'request')

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Requests sent to Anthropic</caption>
        <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-normal">#</th>
            <th className="px-3 py-2 font-normal">Sent</th>
            <th className="px-3 py-2 font-normal">Agent</th>
            <th className="px-3 py-2 font-normal">Model</th>
            <th className="px-3 py-2 text-right font-normal">Took</th>
            <th className="px-3 py-2 text-right font-normal">Input</th>
            <th className="px-3 py-2 text-right font-normal">Cache read</th>
            <th className="px-3 py-2 text-right font-normal">Cache write</th>
            <th className="px-3 py-2 text-right font-normal">Output</th>
            <th className="px-4 py-2 text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((node, i) => {
            const usage = node.request?.usage
            const replied = node.request?.hasReply === true && usage !== undefined
            return (
              <tr key={node.id} className={`border-t border-line ${node.id === selectedId ? 'bg-surface-raised' : ''}`}>
                <td className="px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    aria-label={`Open request ${i + 1}`}
                    className="text-primary hover:text-primary-hover"
                  >
                    {i + 1}
                  </button>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">{formatClock(node.startedAt)}</td>
                <td className="px-3 py-1.5">{agents.get(node.agentId) ?? node.agentId}</td>
                <td className="px-3 py-1.5 text-muted">
                  {node.request?.model}
                  {node.error && <span className="ml-2 text-danger">failed</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted">
                  {replied ? formatDuration(node.endedAt - node.startedAt) : '–'}
                </td>
                {replied ? (
                  <>
                    <td className="px-3 py-1.5 text-right">{formatCount(usage.input)}</td>
                    <td className="px-3 py-1.5 text-right">{formatCount(usage.cacheRead)}</td>
                    <td className="px-3 py-1.5 text-right">{formatCount(usage.cacheWrite5m + usage.cacheWrite1h)}</td>
                    <td className="px-3 py-1.5 text-right">{formatCount(usage.output)}</td>
                    <td className="whitespace-nowrap px-4 py-1.5 text-right">
                      {formatCost(node.request?.costUsd ?? null)}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="px-4 py-1.5 text-right text-subtle">
                    no reply recorded
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
