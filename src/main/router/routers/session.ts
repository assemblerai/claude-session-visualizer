import { z } from 'zod'
import type { BodySlice, NodeDetail, SessionGraph } from '../../../shared/session.js'
import { publicProcedure, router } from '../trpc.js'

const sessionId = z.string().min(1)

/** One open session. Bodies stay in main until a node is clicked. */
export const sessionRouter = router({
  /** Every node and edge, with labels and numbers but no bodies. Asking again picks up a running session's new lines. */
  graph: publicProcedure.input(z.object({ sessionId })).query(({ ctx, input }): Promise<SessionGraph> => ctx.sessionStore.graph(input.sessionId)),
  nodeDetail: publicProcedure
    .input(z.object({ sessionId, nodeId: z.string().min(1) }))
    .query(({ ctx, input }): Promise<NodeDetail> => ctx.sessionStore.nodeDetail(input.sessionId, input.nodeId)),
  /** The next slice of a body too large to send whole. */
  body: publicProcedure
    .input(z.object({ sessionId, bodyRef: z.string().min(1), offset: z.number().int().min(0) }))
    .query(({ ctx, input }): Promise<BodySlice> => ctx.sessionStore.body(input.sessionId, input.bodyRef, input.offset)),
})
