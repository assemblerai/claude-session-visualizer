import { z } from 'zod'
import type { SessionSummary } from '../../../shared/session.js'
import { publicProcedure, router } from '../trpc.js'

/** The imported sessions: listing them, importing more, and forgetting one. */
export const sessionsRouter = router({
  /** Rows not read yet come back `pending`; ask again to see them filled in. */
  list: publicProcedure.query(({ ctx }): Promise<SessionSummary[]> => ctx.sessionIndex.list()),
  /**
   * Opens the file dialog in the projects folder the last import came from, or
   * the detected `.claude/projects`, and imports what is picked. Answers how many
   * were imported: 0 when the dialog was cancelled.
   */
  import: publicProcedure.mutation(async ({ ctx }): Promise<number> => {
    const [last] = await ctx.settings.getImported()
    const [root] = await ctx.settings.getRoots()
    const picked = await ctx.pickSessionFiles(last ?? root)
    if (picked.length === 0) return 0
    await ctx.settings.addImported(await ctx.sessionIndex.checkImport(picked))
    return picked.length
  }),
  /** Forgets an imported session. The file itself is never touched. */
  remove: publicProcedure.input(z.object({ path: z.string().min(1) })).mutation(async ({ ctx, input }): Promise<void> => {
    await ctx.settings.removeImported(input.path)
  }),
})
