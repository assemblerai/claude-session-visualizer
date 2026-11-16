import { createTRPCReact } from '@trpc/react-query'
import { TRPCClientError, type TRPCClient, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AnyTRPCRouter } from '@trpc/server'
import type { AppRouter } from '../../main/router/index.js'

/**
 * Typed client, inferred from the router in main. `AppRouter` is a type-only
 * import, so no main-process code reaches the renderer bundle -- only its shape.
 */
export const trpc = createTRPCReact<AppRouter>()

/** Transport link over Electron IPC. Queries and mutations only. */
export function ipcLink<TRouter extends AnyTRPCRouter = AppRouter>(): TRPCLink<TRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const { path, input, type } = op

        if (type === 'subscription') {
          observer.error(new TRPCClientError('subscriptions are not supported over the IPC link yet'))
          return
        }

        let cancelled = false

        window.api.trpc
          .invoke({ path, input, type })
          .then((response) => {
            if (cancelled) return
            if (!response.ok) {
              observer.error(new TRPCClientError(response.error.message, { meta: { code: response.error.code } }))
              return
            }
            observer.next({ result: { data: response.data } })
            observer.complete()
          })
          .catch((error: unknown) => {
            if (cancelled) return
            observer.error(TRPCClientError.from(error as Error))
          })

        return () => {
          cancelled = true
        }
      })
}

export function createTrpcClient(): TRPCClient<AppRouter> {
  return trpc.createClient({ links: [ipcLink()] })
}
