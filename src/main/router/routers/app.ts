import type { PingResult } from '../../../shared/types.js'
import { publicProcedure, router } from '../trpc.js'

/** The application itself, as opposed to anything it manages. */
export const appInfoRouter = router({
  /** Proves the round trip: renderer, preload bridge, IPC, adapter, router and back. */
  ping: publicProcedure.query(({ ctx }): PingResult => ({ ok: true, version: ctx.version })),
})
