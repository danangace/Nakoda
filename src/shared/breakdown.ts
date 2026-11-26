/**
 * The line format of a subtask breakdown: written by a person, or by Claude following the
 * `helix-breakdown-subtasks` skill. One parser reads both, so what is shown is what is created.
 *
 *   - [BE] Add paged invoice list endpoint (2)
 *   - [FE] Show invoice list with search and status filter (3)
 *   Note: AC-4 (export) has no API contract; ask the TPM first.
 */

/** Helix refuses a longer title. */
export const MAX_TITLE = 500
/** Largest a subtask should be; above it, split. */
export const MAX_POINTS = 5
/** One create call carries at most this many (matches the write schema). */
export const MAX_SUBTASKS = 30
/** Types Helix lets hold subtasks. */
export const PARENT_TYPES_FOR_SUBTASKS = ['story', 'task', 'tech_improvement', 'bug', 'defect_staging'] as const

export type RowIssue = { level: 'error' | 'warning'; text: string }
export type ParsedRow = { title: string; storyPoint: number | null }
export type ParsedList = { rows: ParsedRow[]; notes: string[] }

const BULLET = /^(?:[-*•]|\d{1,3}[.)])(?:\s+|$)/
const CHECKBOX = /^\[[ xX]\]\s+/
const POINTS = /\s*\(\s*(\d{1,3})\s*(?:sp|pts?|points?)?\s*\)\s*$/i
const NOTE = /^note\s*:\s*/i
const LAYER = /^\[(fe|be)\]\s*/i

/** `[fe]  Add x` → `[FE] Add x`. Only the two layers are normalised. */
function tidyTitle(title: string): string {
  const m = LAYER.exec(title)
  return m ? `[${(m[1] ?? '').toUpperCase()}] ${title.slice(m[0].length).trim()}` : title.trim()
}

/** Lines to rows: bullets, numbers and checkboxes are stripped, a trailing `(3)` is the story points, `Note:` lines are kept apart. */
export function parseSubtaskList(text: string): ParsedList {
  const rows: ParsedRow[] = []
  const notes: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    if (NOTE.test(line)) {
      notes.push(line.replace(NOTE, '').trim())
      continue
    }
    line = line.replace(BULLET, '').replace(CHECKBOX, '')
    const m = POINTS.exec(line)
    const storyPoint = m ? Number(m[1]) : null
    if (m) line = line.slice(0, m.index)
    const title = tidyTitle(line)
    if (title) rows.push({ title, storyPoint })
  }
  return { rows, notes }
}

/** What is wrong with a row. Errors block creating it; warnings only ask for a second look. */
export function checkRow(title: string, storyPoint: number | null): RowIssue[] {
  const issues: RowIssue[] = []
  const t = title.trim()
  if (!t) issues.push({ level: 'error', text: 'Give it a title' })
  if (t.length > MAX_TITLE) issues.push({ level: 'error', text: `A title holds at most ${MAX_TITLE} characters` })
  if (storyPoint !== null && (!Number.isInteger(storyPoint) || storyPoint <= 0)) issues.push({ level: 'error', text: 'Story points must be a positive whole number' })
  if (t && !LAYER.test(t)) issues.push({ level: 'warning', text: 'Start the title with [FE] or [BE]' })
  if (storyPoint !== null && storyPoint > MAX_POINTS) issues.push({ level: 'warning', text: `Above ${MAX_POINTS} points: split it` })
  return issues
}

/** A title for comparing: no layer tag, no case, no punctuation. */
export function normalizeTitle(title: string): string {
  return title.replace(LAYER, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const layerOf = (title: string): string | null => LAYER.exec(title.trim())?.[1]?.toLowerCase() ?? null

/**
 * The existing subtask a new title most likely repeats: same words, or one inside the other (when long
 * enough to mean something). A [FE] and a [BE] are different work even when their words overlap.
 */
export function findSimilar(title: string, existing: { key: string; title: string }[]): { key: string; title: string } | null {
  const a = normalizeTitle(title)
  if (!a) return null
  return (
    existing.find((e) => {
      const la = layerOf(title)
      const lb = layerOf(e.title)
      if (la && lb && la !== lb) return false
      const b = normalizeTitle(e.title)
      return b !== '' && (a === b || (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a))))
    }) ?? null
  )
}
