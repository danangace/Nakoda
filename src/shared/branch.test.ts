import { describe, expect, it } from 'vitest'
import { branchPrefixFor } from './branch'

describe('branchPrefixFor', () => {
  it('turns feat/ into fix/ for a defect and keeps features as they are', () => {
    expect(branchPrefixFor('feat/tribe-2/', true)).toBe('fix/tribe-2/')
    expect(branchPrefixFor('feat/tribe-2/', false)).toBe('feat/tribe-2/')
  })
  it('leaves a prefix that is not feat/ alone', () => {
    expect(branchPrefixFor('feat/t2/', true)).toBe('fix/t2/')
    expect(branchPrefixFor('work/', true)).toBe('work/')
    expect(branchPrefixFor('', true)).toBe('')
  })
})
