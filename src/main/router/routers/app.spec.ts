import { describe, expect, it } from 'vitest'
import { createCallerFactory, type Context } from '../trpc.js'
import { appInfoRouter } from './app.js'

describe('app.ping', () => {
  it('answers with the running version', async () => {
    const caller = createCallerFactory(appInfoRouter)({ version: '9.9.9' } as Context)
    await expect(caller.ping()).resolves.toEqual({ ok: true, version: '9.9.9' })
  })
})
