import { TRPCError } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import { exitFor, InvariantBroken, Refusal, SystemFailure } from './errors.js'

describe('exitFor', () => {
  it('shows a refusal verbatim and does not log it', () => {
    const exit = exitFor(new Refusal('No such session.', 'NOT_FOUND'))
    expect(exit).toMatchObject({ shown: 'No such session.', unexpected: false })
    expect(exit.refusal?.code).toBe('NOT_FOUND')
  })

  it('looks through the tRPC wrapper to the unit’s own error', () => {
    const wrapped = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: new Refusal('Nope.') })
    expect(exitFor(wrapped).shown).toBe('Nope.')
  })

  it('shows a system failure’s own sentence and logs it', () => {
    expect(exitFor(new SystemFailure('The transcript could not be read.'))).toMatchObject({
      shown: 'The transcript could not be read.',
      unexpected: true,
    })
  })

  it('never shows an invariant or an unknown throw', () => {
    expect(exitFor(new InvariantBroken('bad state')).shown).not.toContain('bad state')
    expect(exitFor('boom').shown).not.toContain('boom')
  })
})
