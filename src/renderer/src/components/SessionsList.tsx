import { FileUp, X } from 'lucide-react'
import { formatBytes, formatCost, formatDateTime, formatDuration } from '../format'
import { useImportSessions, useSessions } from '../hooks/useSessions'

interface SessionsListProps {
  openSessionId: string | null
  onOpen: (sessionId: string) => void
}

/** The sessions imported so far: when each ran, how long it took, how many helpers, roughly what it cost. */
export function SessionsList({ openSessionId, onOpen }: SessionsListProps): React.JSX.Element {
  const sessions = useSessions()
  const { importSessions, remove, isImporting, error } = useImportSessions()

  return (
    <section aria-label="Sessions" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2">
        <button
          type="button"
          onClick={importSessions}
          disabled={isImporting}
          className="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          <FileUp aria-hidden strokeWidth={1.5} className="size-3.5" />
          {isImporting ? 'Choosing…' : 'Import session'}
        </button>
        <span className="text-xs text-muted">Pick a session's .jsonl from a folder under .claude/projects.</span>
      </div>
      {error && <p role="alert" className="px-4 py-2 text-sm text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.error && <p role="alert" className="p-6 text-sm text-danger">{sessions.error}</p>}
        {sessions.isLoading && <p className="p-6 text-sm text-muted">Listing sessions…</p>}
        {!sessions.isLoading && !sessions.error && sessions.items.length === 0 && (
          <p className="p-6 text-sm text-muted">No sessions imported yet. Use “Import session” to pick one.</p>
        )}
        {sessions.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Session</th>
                <th className="px-3 py-2 font-normal">Project</th>
                <th className="px-3 py-2 font-normal">Ran</th>
                <th className="px-3 py-2 text-right font-normal">Duration</th>
                <th className="px-3 py-2 text-right font-normal">Helpers</th>
                <th className="px-3 py-2 text-right font-normal">Cost</th>
                <th className="px-3 py-2 text-right font-normal">Size</th>
                <th className="w-8 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.items.map((session) => {
                const name = session.title ?? session.sessionId
                const duration = session.startedAt !== null && session.endedAt !== null ? formatDuration(session.endedAt - session.startedAt) : '–'
                const why = session.missing ? 'The file is no longer where it was imported from.' : 'This session has no request records, so it cannot be opened.'
                return (
                  <tr key={session.path} className={`border-t border-line ${session.sessionId === openSessionId ? 'bg-surface-raised' : ''}`}>
                    <td className="w-full max-w-0 px-4 py-2">
                      <button
                        type="button"
                        disabled={!session.hasRequests}
                        onClick={() => onOpen(session.sessionId)}
                        title={session.hasRequests ? session.path : why}
                        className="block w-full truncate text-left hover:text-primary disabled:cursor-not-allowed disabled:text-subtle"
                      >
                        {session.pending ? 'Reading…' : name}
                      </button>
                      {session.missing ? (
                        <span className="text-xs text-danger">file not found</span>
                      ) : (
                        !session.hasRequests && <span className="text-xs text-subtle">no request records</span>
                      )}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-muted" title={session.project}>
                      {session.project}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(session.startedAt ?? session.modifiedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{duration}</td>
                    <td className="px-3 py-2 text-right text-muted">{session.pending ? '–' : session.helperCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{session.costUsd === null ? '–' : formatCost(session.costUsd)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{session.missing ? '–' : formatBytes(session.sizeBytes)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => remove(session.path)}
                        aria-label={`Remove ${name}`}
                        title="Remove from the list (the file is not deleted)"
                        className="rounded p-0.5 text-muted hover:bg-surface-raised hover:text-on-surface"
                      >
                        <X aria-hidden strokeWidth={1.5} className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
