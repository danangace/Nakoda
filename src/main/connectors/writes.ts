import { randomUUID } from 'node:crypto'
import { type HelixWrite, type WriteLogEntry, type WritePreview } from '../../shared/connectors'
import { nowIso } from '../paths'
import type { Db } from '../sqlite/db'
import { childrenPath, commentPath, statusPath, subtaskBody } from './helix'

const MENTION = /(^|\s)@\w/

/**
 * Exactly what an action would send, plus what a person should know before saying yes. The call
 * is built from the same helpers, so what is shown is what is sent.
 */
export function buildPreview(action: HelixWrite, meId: number | null): WritePreview {
  if (action.action === 'status') {
    const comment = action.comment?.trim()
    const notes = ['Helix tells the people on the ticket about the move.']
    if (comment && MENTION.test(comment)) notes.push('An @mention in the note sends that person an email.')
    if (action.status === 'done') notes.push('Only a person can move a ticket out of done, so this cannot be undone from here.')
    return {
      summary: `Move ${action.key} to ${action.status}${comment ? ' with a note' : ''}`,
      requests: [{ method: 'PATCH', path: statusPath(action.key), body: { status: action.status, ...(comment ? { comment } : {}) } }],
      notes,
    }
  }
  if (action.action === 'comment') {
    const notes = ['A comment cannot be edited or deleted afterwards.']
    if (MENTION.test(action.content)) notes.push('An @mention sends that person an email.')
    return { summary: `Comment on ${action.key}`, requests: [{ method: 'POST', path: commentPath(action.key), body: { content: action.content } }], notes }
  }
  const others = action.items.filter((i) => i.assigneeId !== undefined && i.assigneeId !== meId).length
  const notes = ['Subtasks are created one at a time. If one fails, the rest are not tried.', 'They cannot be deleted from here.']
  if (others > 0) notes.push(`${others} subtask${others === 1 ? ' is' : 's are'} assigned to someone else: they get an email.`)
  return {
    summary: `Add ${action.items.length} subtask${action.items.length === 1 ? '' : 's'} under ${action.parentKey}`,
    requests: action.items.map((i) => ({ method: 'POST' as const, path: childrenPath(action.parentKey), body: subtaskBody(i) })),
    notes,
  }
}

type LogRow = { id: string; at: string; action: WriteLogEntry['action']; ticket_key: string; summary: string; ok: number; error_code: string | null }

/** One line per change Nakoda made (or tried) in Helix. Holds no token. */
export function logWrite(db: Db, entry: { connectorId: string; action: WriteLogEntry['action']; ticketKey: string; summary: string; ok: boolean; errorCode?: string }): void {
  db.prepare('INSERT INTO helix_writes (id, connector_id, at, action, ticket_key, summary, ok, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    entry.connectorId,
    nowIso(),
    entry.action,
    entry.ticketKey,
    entry.summary.slice(0, 500),
    entry.ok ? 1 : 0,
    entry.errorCode ?? null,
  )
}

export function listWrites(db: Db, connectorId: string, limit = 50): WriteLogEntry[] {
  const rows = db.prepare('SELECT * FROM helix_writes WHERE connector_id = ? ORDER BY at DESC, rowid DESC LIMIT ?').all(connectorId, Math.min(Math.max(limit, 1), 200)) as LogRow[]
  return rows.map((r) => ({ id: r.id, at: r.at, action: r.action, ticketKey: r.ticket_key, summary: r.summary, ok: r.ok === 1, errorCode: r.error_code }))
}
