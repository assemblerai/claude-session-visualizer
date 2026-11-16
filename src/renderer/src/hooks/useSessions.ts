import type { SessionSummary } from '@shared/session'
import { trpc } from '../trpc'

export interface Listing<T> {
  items: T[]
  isLoading: boolean
  /** The sentence to show when the list could not be read. */
  error: string | null
}

/** The imported sessions. Rows not read yet arrive `pending` and fill in as main reads them. */
export function useSessions(): Listing<SessionSummary> {
  const { data, isLoading, error } = trpc.sessions.list.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.some((s) => s.pending) ? 1_500 : false),
  })
  return { items: data ?? [], isLoading, error: error?.message ?? null }
}

export interface Importing {
  /** Opens the file dialog at Claude Code's projects folder and imports what is picked. */
  importSessions: () => void
  remove: (path: string) => void
  isImporting: boolean
  /** Why the last import or removal failed. */
  error: string | null
}

export function useImportSessions(): Importing {
  const utils = trpc.useUtils()
  const onSuccess = (): Promise<void> => utils.sessions.list.invalidate()
  const importing = trpc.sessions.import.useMutation({ onSuccess })
  const removing = trpc.sessions.remove.useMutation({ onSuccess })
  return {
    importSessions: () => importing.mutate(),
    remove: (path) => removing.mutate({ path }),
    isImporting: importing.isPending,
    error: importing.error?.message ?? removing.error?.message ?? null,
  }
}
