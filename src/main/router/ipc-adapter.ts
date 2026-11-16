import { ipcMain } from 'electron'
import { TRPCError } from '@trpc/server'
import type { Log } from '../diagnostics/log.js'
import { AppError, exitFor } from '../errors.js'
import { appRouter } from './index.js'
import { createCallerFactory, type Context } from './trpc.js'
import { TRPC_CHANNEL, type TrpcRequest, type TrpcResponse } from '../../shared/types.js'

/**
 * Serves the tRPC routers over Electron IPC. Nothing in the routers knows about
 * IPC, so a maintained transport can replace this file alone. The renderer side
 * is the link in `renderer/src/trpc.ts`.
 */
const createCaller = createCallerFactory(appRouter)

interface ProcedureDef {
  _def: { type: 'query' | 'mutation' | 'subscription' }
}

/**
 * The router's own flat index of procedures, keyed by dotted path. This -- not
 * the caller proxy -- decides whether a renderer-supplied path is real, so
 * nothing on `Object.prototype` is reachable however the string is shaped.
 */
const procedures = appRouter._def.procedures as unknown as Record<string, ProcedureDef>

type Resolution =
  | { ok: true; call: (input: unknown) => Promise<unknown> }
  | { ok: false; code: 'BAD_REQUEST' | 'NOT_FOUND'; message: string }

function bindProcedure(caller: Record<string, unknown>, path: string): ((input: unknown) => Promise<unknown>) | null {
  let node: unknown = caller
  for (const segment of path.split('.')) {
    if (node === null || (typeof node !== 'object' && typeof node !== 'function')) return null
    node = (node as Record<string, unknown>)[segment]
  }
  return typeof node === 'function' ? (node as (input: unknown) => Promise<unknown>) : null
}

function resolveRequest(caller: Record<string, unknown>, request: TrpcRequest): Resolution {
  const { path, type } = request
  const published = Object.prototype.hasOwnProperty.call(procedures, path) ? procedures[path] : undefined

  if (!published) return { ok: false, code: 'NOT_FOUND', message: `no such procedure: ${path}` }
  if (type !== published._def.type) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: `${path} is a ${published._def.type}, called as a ${String(type)}`,
    }
  }

  const call = bindProcedure(caller, path)
  if (!call) return { ok: false, code: 'NOT_FOUND', message: `no such procedure: ${path}` }
  return { ok: true, call }
}

/** A `TRPCError` tRPC raised itself (bad input, unknown path): keeps tRPC's code and message. */
function ownRejection(error: unknown): TRPCError | null {
  if (!(error instanceof TRPCError) || error.code === 'INTERNAL_SERVER_ERROR') return null
  return error.cause instanceof AppError ? null : error
}

function toErrorEnvelope(path: string, error: unknown, log: Log): TrpcResponse {
  const exit = exitFor(error)
  if (exit.refusal) return { ok: false, error: { code: exit.refusal.code, message: exit.shown } }

  const plain = ownRejection(error)
  if (plain) return { ok: false, error: { code: plain.code, message: plain.message } }

  if (exit.unexpected) log.write('error', `trpc(${path}) failed`, error)
  return { ok: false, error: { code: 'INTERNAL_SERVER_ERROR', message: exit.shown } }
}

export function registerTrpcIpc(createContext: () => Context, log: Log): void {
  ipcMain.handle(TRPC_CHANNEL, async (_event, request: TrpcRequest): Promise<TrpcResponse> => {
    const { path, input, type } = request ?? {}

    if (typeof path !== 'string' || path.length === 0) {
      return { ok: false, error: { code: 'BAD_REQUEST', message: 'missing procedure path' } }
    }

    try {
      const caller = createCaller(createContext()) as unknown as Record<string, unknown>
      const resolution = resolveRequest(caller, { path, input, type })
      if (!resolution.ok) return { ok: false, error: { code: resolution.code, message: resolution.message } }
      return { ok: true, data: await resolution.call(input) }
    } catch (error) {
      return toErrorEnvelope(path, error, log)
    }
  })
}
