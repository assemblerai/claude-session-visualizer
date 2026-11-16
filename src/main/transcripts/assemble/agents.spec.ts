import { describe, expect, it } from 'vitest'
import { loadFixtureFiles } from '../fixtures.js'
import { planAgents } from './agents.js'

describe('planAgents', () => {
  it('finds only the main agent in a plain session', () => {
    const { agents, unmatched } = planAgents(loadFixtureFiles('plain'))

    expect(agents.map((a) => a.id)).toEqual(['main'])
    expect(unmatched).toEqual([])
  })

  it('joins a foreground helper at its tool result', () => {
    const [, helper] = planAgents(loadFixtureFiles('one-helper')).agents

    expect(helper).toMatchObject({ parentId: 'main', depth: 1, background: false, type: 'web-fetch' })
    expect(helper?.runs).toEqual([{ spawnToolUseId: 'toolu_017o5XoyyRBrxPmJHaxBhpuC', startUuid: null, join: { via: 'tool-result' } }])
  })

  it('builds the tree of nested helpers from who started whom', () => {
    const { agents } = planAgents(loadFixtureFiles('nested'))

    expect(agents.map((a) => [a.id, a.parentId, a.depth])).toEqual([
      ['main', null, 0],
      ['a440e649178b9695b', 'main', 1],
      ['a3f9dfe69c9529450', 'a440e649178b9695b', 2],
    ])
  })

  it('gives a resumed helper a second run, joined at its task notification', () => {
    const helper = planAgents(loadFixtureFiles('nested')).agents[1]

    expect(helper?.background).toBe(true)
    expect(helper?.runs).toEqual([
      { spawnToolUseId: 'toolu_01K1AEtaSw9gV4HE2phv53eh', startUuid: null, join: { via: 'record', uuid: '32a1f560-387d-46f0-ad81-ca715eb7fee0' } },
      { spawnToolUseId: 'toolu_01FJN51mTdUhY9bTJywRmFCh', startUuid: 'e0da9cdd-8eac-4a73-84af-e25c63faa7f9', join: { via: 'record', uuid: '23246291-2bb9-4ad2-8cae-f3f72ce24135' } },
    ])
  })

  it('leaves a background helper that never reported with no join', () => {
    const helper = planAgents(loadFixtureFiles('nested')).agents[2]

    expect(helper?.runs).toEqual([{ spawnToolUseId: 'toolu_01J1PEbRzP7vydn5tB6Adjc8', startUuid: null, join: null }])
  })

  it('reports a helper whose starting tool request is not in the files', () => {
    const files = loadFixtureFiles('one-helper')
    const [helper] = files.helpers
    if (!helper) throw new Error('fixture has no helper')
    helper.meta.toolUseId = 'toolu_missing'

    expect(planAgents(files)).toMatchObject({ unmatched: ['ab264e6e0b102cad4'], agents: [{ id: 'main' }] })
  })
})
