import { describe, expect, it } from 'vitest'
import { parseOpenQuestions } from './open-questions'

const TABLE = `# Open Questions

| OQ    | Topic                          | Owner | Blocks coding | Status                                   |
| ----- | ------------------------------ | ----- | ------------- | ---------------------------------------- |
| OQ-01 | Summary cards: five or six?    | PM    | no            | **decided** 2026-11-07                   |
| OQ-02 | Status label copy              | PM    | **yes**       | open                                     |
| OQ-03 | Sorting                        | PM    | no            | **out of i-15** 2026-11-08               |
| OQ-04 | Permission slug                | TL    | yes           | **closed** 2026-11-11 (decoration)       |
| OQ-05 | Empty state copy               | UX    | no            | waiting on designer                      |

## OQ-01 — Summary cards
Not a table row.
`

describe('parseOpenQuestions', () => {
  it('counts every question and lists the ones whose status does not say answered', () => {
    expect(parseOpenQuestions(TABLE)).toEqual({
      total: 5,
      open: [
        { id: 'OQ-02', topic: 'Status label copy', blocksCoding: true },
        { id: 'OQ-05', topic: 'Empty state copy', blocksCoding: false },
      ],
    })
  })

  it('reads decided, closed and out-of-scope as answered, with or without bold', () => {
    const t = '| OQ | Topic | Owner | Blocks coding | Status |\n|---|---|---|---|---|\n| OQ-1 | a | x | no | decided |\n| OQ-2 | b | x | no | **Decided** later |\n| OQ-3 | c | x | no | out of scope |'
    expect(parseOpenQuestions(t)).toEqual({ total: 3, open: [] })
  })

  it('finds the columns by their header, not by position', () => {
    const t = '| OQ | Status | Topic | Blocks coding |\n|---|---|---|---|\n| OQ-1 | open | Moved columns | yes |'
    expect(parseOpenQuestions(t)).toEqual({ total: 1, open: [{ id: 'OQ-1', topic: 'Moved columns', blocksCoding: true }] })
  })

  it('has nothing to report when there is no table', () => {
    expect(parseOpenQuestions('# No table here\n\nOQ-01 is mentioned in prose.')).toEqual({ total: 0, open: [] })
  })
})
