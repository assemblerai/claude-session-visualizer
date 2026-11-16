import { describe, expect, it } from 'vitest'
import { agentName } from './session'

describe('agentName', () => {
  it('puts the type before the task', () => {
    expect(agentName('claude', 'TK-198 stage 1 plan')).toBe('claude: TK-198 stage 1 plan')
  })

  it('does not repeat a type the task already starts with', () => {
    expect(agentName('coder-e2e-browser', 'coder-e2e-browser TK-198 round 1')).toBe('coder-e2e-browser TK-198 round 1')
    expect(agentName('eval-plan', 'Eval-plan round 2 TK-149')).toBe('Eval-plan round 2 TK-149')
  })

  it('is just the type when there is no task', () => {
    expect(agentName('general-purpose', '')).toBe('general-purpose')
    expect(agentName('general-purpose', undefined)).toBe('general-purpose')
  })
})
