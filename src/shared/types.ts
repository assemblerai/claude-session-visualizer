/**
 * Types shared by main, preload and renderer. Nothing here may import from
 * electron, node, or the DOM -- all three sides compile it.
 */

/** The single IPC channel every tRPC call travels over. */
export const TRPC_CHANNEL = 'trpc'

export interface TrpcRequest {
  path: string
  input: unknown
  type: 'query' | 'mutation'
}

export interface TrpcError {
  code: string
  message: string
}

export type TrpcResponse = { ok: true; data: unknown } | { ok: false; error: TrpcError }

/** The answer to `app.ping`: the main process is reachable, and which build it is. */
export interface PingResult {
  ok: true
  version: string
}
