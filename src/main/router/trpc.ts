import { initTRPC } from '@trpc/server'
import type { Settings } from '../settings.js'
import type { SessionIndex } from '../transcripts/session-index.js'
import type { SessionStore } from '../transcripts/session-store.js'

/**
 * The tRPC instance and its context.
 *
 * Routers are transport-agnostic and served over a hand-rolled IPC adapter
 * (`ipc-adapter.ts`). The context carries services, never raw clients: routers
 * validate input and shape a response, services do the work.
 */
export interface Context {
  /** The running build's version, as the app reports it. */
  version: string
  /** The detected projects folders and the imported sessions. */
  settings: Settings
  /** Asks the person to pick session files, starting at a folder or file. Empty when they cancel. */
  pickSessionFiles: (startAt: string | undefined) => Promise<string[]>
  /** The session list. */
  sessionIndex: SessionIndex
  /** Open sessions: their graphs and node bodies. */
  sessionStore: SessionStore
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory
