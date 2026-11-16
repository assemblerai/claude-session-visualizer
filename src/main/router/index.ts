import { router } from './trpc.js'
import { appInfoRouter } from './routers/app.js'
import { sessionRouter } from './routers/session.js'
import { sessionsRouter } from './routers/sessions.js'

/**
 * Composition root. Growth is additive: a new domain is one file in routers/
 * plus one line here.
 */
export const appRouter = router({
  app: appInfoRouter,
  sessions: sessionsRouter,
  session: sessionRouter,
})

export type AppRouter = typeof appRouter
