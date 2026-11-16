import { keepPreviousData } from '@tanstack/react-query'
import type { BodySlice, NodeDetail, SessionGraph } from '@shared/session'
import { trpc } from '../trpc'

export interface OpenSession {
  graph: SessionGraph | null
  isLoading: boolean
  error: string | null
}

/**
 * The open session's graph. With `live`, main is asked again every couple of
 * seconds and reads whatever a running session has appended; an unchanged
 * answer keeps the same object, so nothing is laid out again.
 */
export function useSessionGraph(sessionId: string | null, live: boolean): OpenSession {
  const { data, isLoading, error } = trpc.session.graph.useQuery(
    { sessionId: sessionId ?? '' },
    { enabled: sessionId !== null, refetchInterval: live ? 2_000 : false, staleTime: Infinity, placeholderData: keepPreviousData },
  )
  const graph = data && data.sessionId === sessionId ? data : null
  return { graph, isLoading: sessionId !== null && isLoading, error: error?.message ?? null }
}

export interface NodeBodies {
  detail: NodeDetail | null
  isLoading: boolean
  error: string | null
}

/** One node's Input and Output. Fetched on click: bodies stay in main until asked for. */
export function useNodeDetail(sessionId: string | null, nodeId: string | null): NodeBodies {
  const enabled = sessionId !== null && nodeId !== null
  const { data, isLoading, error } = trpc.session.nodeDetail.useQuery({ sessionId: sessionId ?? '', nodeId: nodeId ?? '' }, { enabled, staleTime: 30_000 })
  return { detail: enabled && data?.nodeId === nodeId ? data : null, isLoading: enabled && isLoading, error: error?.message ?? null }
}

/** Fetches the next slice of a body too large to send whole. */
export function useBodyLoader(sessionId: string | null): (bodyRef: string, offset: number) => Promise<BodySlice> {
  const utils = trpc.useUtils()
  return (bodyRef, offset) => utils.session.body.fetch({ sessionId: sessionId ?? '', bodyRef, offset })
}
