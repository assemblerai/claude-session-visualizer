import { TRPCError } from '@trpc/server'

/**
 * The one error hierarchy of the main process. The subclass says who the
 * message is for: a `Refusal` is written for the person and shown verbatim; a
 * `SystemFailure` is written for the person but stands in for a driver/OS
 * failure whose raw text rides on `cause`; an `InvariantBroken` is never shown.
 */
export abstract class AppError extends Error {}

export type RefusalCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'FORBIDDEN' | 'PRECONDITION_FAILED'

export class Refusal extends AppError {
  override name = 'Refusal'
  readonly code: RefusalCode

  constructor(message: string, code: RefusalCode = 'BAD_REQUEST', options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

export class SystemFailure extends AppError {
  override name = 'SystemFailure'
}

export class InvariantBroken extends AppError {
  override name = 'InvariantBroken'
}

const GENERIC = 'Something went wrong. The details are in the log.'

export interface Exit {
  /** Present when the error is a refusal: its code travels to the renderer. */
  refusal?: Refusal
  /** The sentence the person sees. */
  shown: string
  /** Whether this was unplanned and belongs in the log. */
  unexpected: boolean
}

/** Decide what reaches the person -- by class, never by reading a message. */
export function exitFor(error: unknown): Exit {
  const own = error instanceof TRPCError && error.cause instanceof AppError ? error.cause : error

  if (own instanceof Refusal) return { refusal: own, shown: own.message, unexpected: false }
  if (own instanceof SystemFailure) return { shown: own.message, unexpected: true }
  return { shown: GENERIC, unexpected: true }
}
