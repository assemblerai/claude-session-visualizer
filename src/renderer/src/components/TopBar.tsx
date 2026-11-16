import { Activity } from 'lucide-react'
import type { SessionGraph } from '@shared/session'
import { formatCost, formatDuration, formatTokens } from '../format'
import { useAppInfo } from '../hooks/useAppInfo'

interface TopBarProps {
  /** The open session, when there is one. */
  graph: SessionGraph | null
  live: boolean
  onLive: (live: boolean) => void
  /** Open the details panel on the session's summary. */
  onSummary: () => void
}

/** Across the top of the window: the open session's name, duration, total tokens and estimated cost. */
export function TopBar({ graph, live, onLive, onSummary }: TopBarProps): React.JSX.Element {
  const { version, connected } = useAppInfo()

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-raised px-4">
      <Activity aria-hidden strokeWidth={1.5} className="size-4 text-primary" />
      <h1 className="text-sm font-medium">Session Manager</h1>

      {graph && (
        <>
          <span aria-hidden className="text-subtle">
            /
          </span>
          <span className="min-w-0 truncate text-sm" title={graph.sessionId}>
            {graph.title ?? graph.sessionId}
          </span>
          <dl className="flex shrink-0 items-center gap-4 text-xs text-muted">
            <div className="flex gap-1">
              <dt className="sr-only">Duration</dt>
              <dd>{formatDuration(graph.totals.durationMs)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="sr-only">Tokens</dt>
              <dd>{formatTokens(graph.totals.usage)}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="sr-only">Estimated cost</dt>
              <dd>{formatCost(graph.totals.costUsd)} est.</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={onSummary}
            className="shrink-0 rounded border border-line-control px-2 py-0.5 text-xs text-muted hover:text-on-surface"
          >
            Summary
          </button>
          <label
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
            title="Keep reading the session's files while it is still running"
          >
            <input type="checkbox" checked={live} onChange={(event) => onLive(event.target.checked)} />
            Live
          </label>
        </>
      )}

      <div className="flex-1" />

      <span className="shrink-0 text-xs text-muted">{connected && version ? `v${version}` : 'Connecting…'}</span>
    </header>
  )
}
