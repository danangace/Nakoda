/**
 * A module's Open Questions file starts with a summary table (OQ-01 … with Owner, Blocks coding and
 * Status). A question counts as answered when its status says so; anything else is still open. This
 * is what a spec must pass before its breakdown is worth drafting.
 */
export type OpenQuestion = { id: string; topic: string; blocksCoding: boolean }
export type OpenQuestionsReport = { total: number; open: OpenQuestion[] }

const ANSWERED = /decided|closed|out of|answered|resolved|dropped|superseded/i
const plain = (cell: string): string => cell.replaceAll('*', '').trim()

export function parseOpenQuestions(markdown: string): OpenQuestionsReport {
  let blocksAt = -1
  let statusAt = -1
  let topicAt = -1
  let total = 0
  const open: OpenQuestion[] = []
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    const first = plain(cells[0] ?? '')
    if (/^OQ$/i.test(first)) {
      // The header row says which column is which; a table without these columns falls back to the last cell.
      blocksAt = cells.findIndex((c) => /block/i.test(c))
      statusAt = cells.findIndex((c) => /^status$/i.test(plain(c)))
      topicAt = cells.findIndex((c) => /topic/i.test(c))
      continue
    }
    if (!/^OQ-\d+$/i.test(first)) continue
    total++
    const status = plain(cells[statusAt >= 0 ? statusAt : cells.length - 1] ?? '')
    if (ANSWERED.test(status)) continue
    open.push({ id: first.toUpperCase(), topic: plain(cells[topicAt >= 0 ? topicAt : 1] ?? ''), blocksCoding: blocksAt >= 0 && /^yes/i.test(plain(cells[blocksAt] ?? '')) })
  }
  return { total, open }
}
