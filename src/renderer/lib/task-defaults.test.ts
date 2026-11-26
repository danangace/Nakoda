import { describe, expect, it } from 'vitest'
import { resolveIteration } from './task-defaults'

const list = [
  { id: 95, name: 'Iteration 15', status: 'active' },
  { id: 82, name: 'Iteration 14b', status: 'closed' },
]

describe('resolveIteration', () => {
  it('follows the active iteration, or the exact one while it still exists', () => {
    expect(resolveIteration(list, 'active')).toBe(95)
    expect(resolveIteration(list, 82)).toBe(82)
  })
  it('gives nothing when there is no default, no active iteration, or the saved one is gone', () => {
    expect(resolveIteration(list, null)).toBeNull()
    expect(resolveIteration([list[1] as (typeof list)[number]], 'active')).toBeNull()
    expect(resolveIteration(list, 7)).toBeNull()
  })
})
