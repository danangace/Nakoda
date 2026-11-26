import { describe, expect, it } from 'vitest'
import { MAX_TITLE, checkRow, extractBreakdown, findSimilar, formatSubtaskList, normalizeTitle, parseSubtaskList } from './breakdown'

describe('parseSubtaskList', () => {
  it('reads one subtask per line, bullets or not, with trailing story points', () => {
    const { rows, notes } = parseSubtaskList('- [BE] Add paged endpoint (2)\n* [FE] Show the list (3 sp)\n1. [FE] Empty state (1 pts)\n[fe] plain line\n')
    expect(rows).toEqual([
      { title: '[BE] Add paged endpoint', storyPoint: 2 },
      { title: '[FE] Show the list', storyPoint: 3 },
      { title: '[FE] Empty state', storyPoint: 1 },
      { title: '[FE] plain line', storyPoint: null },
    ])
    expect(notes).toEqual([])
  })

  it('strips checkboxes and numbering but keeps a [FE] tag that looks like one', () => {
    expect(parseSubtaskList('- [ ] [FE] First\n- [x] [BE] Second\n2) [FE] Third').rows.map((r) => r.title)).toEqual(['[FE] First', '[BE] Second', '[FE] Third'])
  })

  it('keeps Note: lines apart, skips blank lines and handles Windows line ends', () => {
    const { rows, notes } = parseSubtaskList('\r\n- [FE] One\r\n\r\nNote: AC-4 has no contract\r\nnote : second\r\n')
    expect(rows).toHaveLength(1)
    expect(notes).toEqual(['AC-4 has no contract', 'second'])
  })

  it('only treats a number at the very end as story points', () => {
    expect(parseSubtaskList('- [FE] Sort by (2) columns').rows).toEqual([{ title: '[FE] Sort by (2) columns', storyPoint: null }])
    expect(parseSubtaskList('- [FE] Keep 3 items (5)').rows[0]).toEqual({ title: '[FE] Keep 3 items', storyPoint: 5 })
  })

  it('drops a line that is only a bullet', () => {
    expect(parseSubtaskList('-\n- \n- (3)').rows).toEqual([])
  })
})

describe('checkRow', () => {
  it('blocks an empty or too long title and bad points', () => {
    expect(checkRow('  ', null).some((i) => i.level === 'error')).toBe(true)
    expect(checkRow(`[FE] ${'x'.repeat(MAX_TITLE)}`, null).some((i) => i.level === 'error')).toBe(true)
    expect(checkRow('[FE] ok', 0).some((i) => i.level === 'error')).toBe(true)
    expect(checkRow('[FE] ok', 2.5).some((i) => i.level === 'error')).toBe(true)
  })

  it('only warns about a missing layer tag and about more than 5 points', () => {
    expect(checkRow('Add x', 2)).toEqual([{ level: 'warning', text: 'Start the title with [FE] or [BE]' }])
    expect(checkRow('[BE] Add x', 8)).toEqual([{ level: 'warning', text: 'Above 5 points: split it' }])
    expect(checkRow('[BE] Add x', 5)).toEqual([])
  })
})

describe('findSimilar', () => {
  const existing = [
    { key: 'T2-1', title: '[FE] Invoice list with search' },
    { key: 'T2-2', title: '[BE] Add paged invoice endpoint' },
  ]
  it('matches the same words ignoring tag, case and punctuation', () => {
    expect(normalizeTitle('[FE] Invoice list, with SEARCH!')).toBe('invoice list with search')
    expect(findSimilar('[FE] invoice list with search', existing)?.key).toBe('T2-1')
  })
  it('matches one title inside another when long enough, and not a short one', () => {
    expect(findSimilar('[BE] Add paged invoice endpoint for export', existing)?.key).toBe('T2-2')
    expect(findSimilar('[FE] Search', existing)).toBeNull()
    expect(findSimilar('[FE] Totally different work', existing)).toBeNull()
    expect(findSimilar('[FE] ', existing)).toBeNull()
  })
  it('does not treat a [FE] and a [BE] as the same work, even when the words overlap', () => {
    expect(findSimilar('[BE] Invoice list with search', existing)).toBeNull()
    expect(findSimilar('Invoice list with search', existing)?.key).toBe('T2-1')
  })
})

describe('extractBreakdown', () => {
  const DOC = `---
helix: T2-3252
spec: "[[FE-01 Invoices]]"
- [FE] not a list item of the document: it is frontmatter
---
# Breakdown T2-3252

Some words about why. A line that mentions [FE] in prose is not a subtask.

## Subtasks

- [BE] Add paged invoice list endpoint (2)
- [fe] Show invoice list with search (3 sp)
  - nested detail that is not tagged
1. [FE] Empty and error states (1)
* [ ] [FE] Export dialog (3)
- Plain bullet without a layer
> Note: AC-4 has no contract

Note: ask the TPM
`

  it('takes only the tagged list items and the Notes, from a document with prose and frontmatter around them', () => {
    const { rows, notes } = extractBreakdown(DOC)
    expect(rows).toEqual([
      { title: '[BE] Add paged invoice list endpoint', storyPoint: 2 },
      { title: '[FE] Show invoice list with search', storyPoint: 3 },
      { title: '[FE] Empty and error states', storyPoint: 1 },
      { title: '[FE] Export dialog', storyPoint: 3 },
    ])
    expect(notes).toEqual(['AC-4 has no contract', 'ask the TPM'])
  })

  it('finds nothing in a spec that has no breakdown, so the person is told rather than given junk rows', () => {
    expect(extractBreakdown('# FE-01\n\nAC-1: the list shows invoices.\n\n- A bullet\n- [x] A checklist item\n')).toEqual({ rows: [], notes: [] })
    expect(extractBreakdown('')).toEqual({ rows: [], notes: [] })
  })

  it('reads a list inside a code fence too, and gives the same list back through formatSubtaskList', () => {
    const { rows, notes } = extractBreakdown('Pasted from the skill:\n```\n- [BE] One (2)\n- [FE] Two\nNote: gap\n```')
    expect(formatSubtaskList(rows, notes)).toBe('- [BE] One (2)\n- [FE] Two\nNote: gap')
    expect(parseSubtaskList(formatSubtaskList(rows, notes))).toEqual({ rows, notes })
  })
})
