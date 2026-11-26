import { type AllowedTransitions, type ExternalPage, type ExternalQuery, type ExternalTicket, HELIX_STATUSES, type Iteration, type SubtaskDraft, type TestResult } from '../../shared/connectors'
import { UserError } from '../errors'
import { redactTokens } from './secrets'
import { tiptapToMarkdown } from './tiptap'

type Fetch = typeof fetch

export type HelixOptions = {
  baseUrl: string
  token: string
  /** Replaceable in tests. */
  fetch?: Fetch
  /** Wait between a `503 busy` and its one retry; replaceable in tests. */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

const REQUEST_TIMEOUT_MS = 20_000
const EXPIRY_WARNING_DAYS = 30
/** Helix allows `limit` 1–200; the list asks for a modest page. */
export const PAGE_SIZE = 50

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1'

/** The base URL must be https (localhost may be http, for development); returns it without a trailing slash. */
export function normalizeBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new UserError('invalid_base_url', 'That is not a web address. Use something like https://project.sesi.id')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new UserError('invalid_base_url', 'Helix must be reached over https')
  }
  return url.origin
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Defects and bugs follow the defect workflow; everything else is a task. */
export function ticketKind(type: string): 'task' | 'defect' {
  return /^(defect|bug)/i.test(type) ? 'defect' : 'task'
}

/** Ticket types that can have subtasks in Helix. */
export const PARENT_TYPES = new Set(['story', 'task', 'epic', 'tech_improvement'])
const PARENT_PAGE_SIZE = 200
const MAX_PARENT_PAGES = 5
const PARENT_CONCURRENCY = 4

export class HelixClient {
  private readonly base: string
  private readonly token: string
  private readonly doFetch: Fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number

  constructor(options: HelixOptions) {
    this.base = normalizeBaseUrl(options.baseUrl)
    this.token = options.token
    this.doFetch = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  }

  ticketUrl(key: string): string {
    return `${this.base}/tickets/${encodeURIComponent(key)}`
  }

  /** GET one path; maps Helix's errors to messages a person can act on. Never follows a redirect (it could carry the token elsewhere). */
  private async get(path: string, retried = false): Promise<Record<string, unknown>> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new UserError('helix_unreachable', `Cannot reach Helix at ${this.base}.`)
    }
    if (res.status >= 300 && res.status < 400) {
      throw new UserError('helix_redirect', `Helix at ${this.base} redirected the request. Check the address.`)
    }
    if (res.status === 503 && !retried) {
      const wait = Math.min(Number(res.headers.get('Retry-After')) || 2, 10)
      await this.sleep(wait * 1000)
      return this.get(path, true)
    }
    const body = asRecord(await res.json().catch(() => ({})))
    if (res.ok) return body
    const code = str(body.error) ?? str(asRecord(body.error).code) ?? ''
    if (res.status === 401) throw new UserError('helix_token', 'Helix token is missing, wrong or expired. Create a new read-only token.')
    if (res.status === 403) throw new UserError('helix_forbidden', 'This token cannot read that. Use a read_only token.')
    if (res.status === 404) throw new UserError('helix_not_found', 'Ticket not found (or not visible to this token).', 404)
    if (res.status === 429) throw new UserError('helix_rate_limited', 'Helix is rate limiting requests. Try again in a minute.')
    if (res.status === 503) throw new UserError('helix_busy', 'Helix is busy. Try again in a moment.')
    throw new UserError('helix_error', redactTokens(`Helix answered ${res.status}${code ? ` (${code})` : ''}.`))
  }

  /** Who the token belongs to, its scope and expiry. Warns about a token that can write or is about to expire. */
  async test(now = new Date(), mode: 'read' | 'write' = 'read'): Promise<TestResult> {
    const data = asRecord((await this.get('/api/auth/me')).data)
    const token = asRecord(data.token)
    const scope = str(token.scope) ?? 'unknown'
    const capabilities = Array.isArray(token.capabilities) ? token.capabilities.filter((c): c is string => typeof c === 'string') : []
    const expiresAt = str(token.expires_at)
    const warnings: string[] = []
    if (mode === 'read') {
      if (scope !== 'read_only') warnings.push(`This token can do more than read (scope ${scope}). Use a read_only token here; changing tickets has its own token.`)
      if (!capabilities.includes('read')) warnings.push('This token cannot read tickets.')
    } else {
      for (const need of ['read', 'create', 'write']) {
        if (!capabilities.includes(need)) warnings.push(`This token cannot ${need === 'read' ? 'read tickets' : need === 'create' ? 'create tickets, subtasks or comments' : 'change tickets or move their status'} (it lacks "${need}"). Create one with the ticket_authoring scope.`)
      }
    }
    if (expiresAt) {
      const days = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000)
      if (days < 0) warnings.push('This token has expired. Create a new one.')
      else if (days < EXPIRY_WARNING_DAYS) warnings.push(`This token expires in ${days} day${days === 1 ? '' : 's'}. Helix cannot renew it; create a new one before then.`)
    }
    return {
      ok: true,
      owner: { id: Number(data.id) || 0, name: str(data.name) ?? '', username: str(data.username) ?? '' },
      scope,
      capabilities,
      expiresAt,
      warnings,
    }
  }

  async boards(): Promise<{ id: number; name: string }[]> {
    const rows = (await this.get('/api/boards/')).data
    return (Array.isArray(rows) ? rows : []).map(asRecord).map((b) => ({ id: Number(b.id), name: str(b.name) ?? `Board ${b.id}` }))
  }

  async iterations(boardId: number): Promise<Iteration[]> {
    if (!Number.isInteger(boardId)) throw new UserError('invalid_board', 'Pick a board first')
    const rows = (await this.get(`/api/boards/${boardId}/milestones`)).data
    return (Array.isArray(rows) ? rows : []).map(asRecord).map((m) => ({ id: Number(m.id), name: str(m.name) ?? `Iteration ${m.id}`, status: str(m.status) ?? '' }))
  }

  /**
   * The External list. Uses search (paged, filterable), never the whole-board endpoint. Filters are
   * numbers we checked ourselves: Helix ignores a bad filter value and would answer with everything.
   */
  async list(query: ExternalQuery & { meId: number }): Promise<ExternalPage> {
    const params = new URLSearchParams({ page: String(Math.max(1, query.page ?? 1)), limit: String(PAGE_SIZE) })
    if (query.mine !== false) params.set('assignee_id', String(query.meId))
    if (query.boardId !== undefined) {
      if (!Number.isInteger(query.boardId)) throw new UserError('invalid_board', 'Unknown board')
      params.set('board_id', String(query.boardId))
    }
    if (query.iterationId !== undefined) {
      if (!Number.isInteger(query.iterationId)) throw new UserError('invalid_iteration', 'Unknown iteration')
      params.set('milestone_id', String(query.iterationId))
    }
    for (const status of query.statuses ?? []) {
      if (!(HELIX_STATUSES as readonly string[]).includes(status)) throw new UserError('invalid_status', `Unknown status "${status}". Use one of: ${HELIX_STATUSES.join(', ')}`)
      params.append('status', status)
    }
    const body = await this.get(`/api/search?${params}`)
    const rows = Array.isArray(body.data) ? body.data : []
    return {
      items: rows.map(asRecord).filter((r) => r.archived !== true).map((r) => this.listItem(r)),
      total: Number(body.total) || 0,
      page: Number(body.page) || 1,
      limit: Number(body.limit) || PAGE_SIZE,
    }
  }

  private listItem(r: Record<string, unknown>): ExternalTicket {
    const key = str(r.ticket_key) ?? String(r.id)
    const type = str(r.type) ?? 'task'
    return {
      key,
      title: str(r.title) ?? key,
      kind: ticketKind(type),
      type,
      status: str(r.status) ?? '',
      statusCategory: str(r.status_category),
      priority: str(r.priority),
      board: str(r.board_name),
      iteration: str(r.milestone_name),
      assignee: str(asRecord(r.assignee).name),
      assigneeId: Number(r.assignee_id ?? asRecord(r.assignee).id) || null,
      dueDate: str(r.due_date),
      url: this.ticketUrl(key),
    }
  }

  /**
   * A ticket's child tickets (subtasks, defects), as list rows. Helix search never returns
   * subtasks (verified 2026-11-13: `type=subtask` gives 0), so their parent is the only way to them.
   */
  async children(key: string): Promise<ExternalTicket[]> {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new UserError('invalid_ticket_key', 'That is not a ticket key')
    const data = asRecord((await this.get(`/api/tickets/${encodeURIComponent(key)}`)).data)
    const rows = Array.isArray(data.children) ? data.children : []
    return rows.map(asRecord).filter((r) => r.archived !== true && str(r.ticket_key)).map((r) => this.listItem(r))
  }

  /**
   * Child tickets of any type (subtasks, defects) assigned to `meId` in one iteration. Helix search filters on the top-level ticket's
   * assignee and never returns subtasks (verified 2026-11-13), so a subtask of yours under a story
   * assigned to someone else (or to nobody) is only reachable through that story. So: list every
   * parent in the iteration, whoever owns it, and read its children. Bounded by needing an iteration.
   */
  async mySubtasks(query: { boardId?: number; iterationId: number; meId: number }): Promise<ExternalTicket[]> {
    if (!Number.isInteger(query.iterationId)) throw new UserError('invalid_iteration', 'Unknown iteration')
    if (query.boardId !== undefined && !Number.isInteger(query.boardId)) throw new UserError('invalid_board', 'Unknown board')
    const parents: ExternalTicket[] = []
    for (let page = 1; page <= MAX_PARENT_PAGES; page++) {
      const params = new URLSearchParams({ page: String(page), limit: String(PARENT_PAGE_SIZE), milestone_id: String(query.iterationId) })
      if (query.boardId !== undefined) params.set('board_id', String(query.boardId))
      const body = await this.get(`/api/search?${params}`)
      const rows = (Array.isArray(body.data) ? body.data : []).map(asRecord)
      parents.push(...rows.filter((r) => r.archived !== true && PARENT_TYPES.has(str(r.type) ?? '')).map((r) => this.listItem(r)))
      if (rows.length < PARENT_PAGE_SIZE || page * PARENT_PAGE_SIZE >= (Number(body.total) || 0)) break
    }
    const mine: ExternalTicket[] = []
    // A few at a time, to be gentle with Helix.
    for (let i = 0; i < parents.length; i += PARENT_CONCURRENCY) {
      const batch = parents.slice(i, i + PARENT_CONCURRENCY)
      const kids = await Promise.all(batch.map((p) => this.children(p.key)))
      batch.forEach((p, j) => {
        for (const c of kids[j] ?? []) if (c.assigneeId === query.meId) mine.push({ ...c, iteration: c.iteration ?? p.iteration, board: c.board ?? p.board, parent: { key: p.key, title: p.title } })
      })
    }
    return mine
  }

  /**
   * One change. Never retried (a retry could do it twice) and never followed through a redirect.
   * Returns Helix's whole answer; `warnings` ride along in it.
   */
  private async write(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<Record<string, unknown>> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method,
        redirect: 'manual',
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new UserError('helix_unreachable', `Cannot reach Helix at ${this.base}. The change may not have been saved: look at the ticket before trying again.`)
    }
    if (res.status >= 300 && res.status < 400) throw new UserError('helix_redirect', `Helix at ${this.base} redirected the request. Check the address.`)
    const parsed = asRecord(await res.json().catch(() => ({})))
    if (res.ok) return parsed
    throw writeError(res.status, parsed)
  }

  /** Where each ticket type may go from each status on a board (the board only scopes the read). */
  async allowedTransitions(boardId: number): Promise<AllowedTransitions> {
    if (!Number.isInteger(boardId)) throw new UserError('invalid_board', 'Pick a board first')
    const raw = asRecord(asRecord((await this.get(`/api/boards/${boardId}/allowed-transitions`)).data).transitions)
    return Object.fromEntries(
      Object.entries(raw).map(([type, byStatus]) => [type, Object.fromEntries(Object.entries(asRecord(byStatus)).map(([from, to]) => [from, (Array.isArray(to) ? to : []).filter((s): s is string => typeof s === 'string')]))]),
    )
  }

  /** Move a ticket. A `comment` is stored in the same step, so a refused move leaves no note. */
  async moveStatus(key: string, status: string, comment?: string): Promise<{ status: string; warnings: string[] }> {
    const body = { status, ...(comment?.trim() ? { comment: comment.trim() } : {}) }
    const answer = await this.write('PATCH', statusPath(key), body)
    return { status: str(asRecord(answer.data).status) ?? status, warnings: warningsOf(answer) }
  }

  async addComment(key: string, content: string): Promise<{ warnings: string[] }> {
    return { warnings: warningsOf(await this.write('POST', commentPath(key), { content })) }
  }

  /** A subtask under an existing ticket. Helix works out the iteration (the parent's) and the due date. */
  async createSubtask(parentKey: string, draft: SubtaskDraft): Promise<{ key: string; warnings: string[] }> {
    const answer = await this.write('POST', childrenPath(parentKey), subtaskBody(draft))
    const key = str(asRecord(answer.data).ticket_key)
    if (!key) throw new UserError('helix_error', 'Helix answered without a ticket key. Check the parent before trying again.')
    return { key, warnings: warningsOf(answer) }
  }

  /** The full ticket, always read fresh (a list row has no rich text). */
  async ticket(key: string): Promise<HelixTicket> {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new UserError('invalid_ticket_key', 'That is not a ticket key')
    return mapTicket((await this.get(`/api/tickets/${encodeURIComponent(key)}`)).data, this.ticketUrl(key))
  }
}

export type HelixTicket = {
  key: string
  title: string
  kind: 'task' | 'defect'
  type: string
  status: string
  priority: string | null
  severity: string | null
  environment: string | null
  board: string | null
  /** As Helix names it (`Iteration 15`). */
  iterationName: string | null
  /** Nakoda's short form (`i-15`), null when the name does not look like `Iteration N`. */
  iteration: string | null
  /** Markdown, in reading order; for a defect: steps, expected, actual. */
  description: string
  /** Each rich-text field on its own (markdown), by Helix name, e.g. `steps_to_reproduce`. */
  sections: Record<string, string>
  /** The parent ticket's key (a subtask's story), if any. */
  parentKey: string | null
  /** Child tickets (subtasks and defects), live ones only, each with a link to Helix. */
  children: { key: string; type: string; title: string; status: string; url: string }[]
  /** Every PRD / Figma link found in the ticket's custom fields. */
  prdLinks: string[]
  figmaLinks: string[]
  url: string
}

/** `Iteration 15` → `i-15`, `Iteration 14b` → `i-14b`. */
export function iterationShort(name: string | null): string | null {
  const m = name?.match(/^iteration\s+(\d+[a-z]?)$/i)
  return m ? `i-${m[1]?.toLowerCase()}` : null
}

const urlsOf = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(/[,\s]+/).filter((u) => /^https?:\/\//i.test(u)) : []

export const SECTIONS: [field: string, heading: string][] = [
  ['description', 'Description'],
  ['objective', 'Objective'],
  ['scope', 'Scope'],
  ['acceptance_criteria', 'Acceptance criteria'],
  ['steps_to_reproduce', 'Steps to reproduce'],
  ['expected_behavior', 'Expected behavior'],
  ['actual_behavior', 'Actual behavior'],
  ['root_cause', 'Root cause'],
]

export function mapTicket(raw: unknown, url: string): HelixTicket {
  const t = asRecord(raw)
  const type = str(t.type) ?? 'task'
  const fields = (Array.isArray(t.fields) ? t.fields : []).map(asRecord)
  const field = (name: string) => fields.filter((f) => f.field_key === name).flatMap((f) => urlsOf(f.field_value))
  const iterationName = str(asRecord(t.milestone).name)
  const sections = Object.fromEntries(SECTIONS.map(([key]) => [key, tiptapToMarkdown(t[key])] as const).filter(([, md]) => md !== ''))
  const origin = new URL(url).origin
  const children = (Array.isArray(t.children) ? t.children : [])
    .map(asRecord)
    .filter((c) => c.archived !== true && str(c.ticket_key))
    .map((c) => ({ key: str(c.ticket_key) ?? '', type: str(c.type) ?? '', title: str(c.title) ?? '', status: str(c.status) ?? '', url: `${origin}/tickets/${encodeURIComponent(str(c.ticket_key) ?? '')}` }))
  const subtasks = children.length
    ? `## Subtasks (${children.length})\n\n${children.map((c) => `- [${c.key}](${c.url}) · ${[c.type, c.status].filter(Boolean).join(' · ')} — ${c.title}`).join('\n')}`
    : ''
  const description = [...SECTIONS.map(([key, heading]) => [heading, sections[key] ?? ''] as const).filter(([, md]) => md !== '').map(([heading, md]) => `## ${heading}\n\n${md}`), subtasks]
    .filter(Boolean)
    .join('\n\n')
  return {
    key: str(t.ticket_key) ?? '',
    title: str(t.title) ?? '',
    kind: ticketKind(type),
    type,
    status: str(t.status) ?? '',
    priority: str(t.priority),
    severity: str(t.severity),
    environment: str(t.environment),
    board: str(asRecord(t.board).name),
    iterationName,
    iteration: iterationShort(iterationName),
    description,
    sections,
    parentKey: str(asRecord(t.parent).ticket_key),
    children,
    prdLinks: [...field('prd_links'), ...urlsOf(t.prd_link)],
    figmaLinks: [...field('figma_links'), ...urlsOf(t.figma_link)],
    url,
  }
}

const keyPart = (key: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new UserError('invalid_ticket_key', 'That is not a ticket key')
  return encodeURIComponent(key)
}
export const statusPath = (key: string) => `/api/tickets/${keyPart(key)}/status`
export const commentPath = (key: string) => `/api/tickets/${keyPart(key)}/comments`
export const childrenPath = (key: string) => `/api/tickets/${keyPart(key)}/children`

/** What a subtask sends. A planned start goes as the midnight (UTC) Helix expects. */
export function subtaskBody(d: SubtaskDraft): Record<string, unknown> {
  return {
    title: d.title,
    type: 'subtask',
    ...(d.storyPoint ? { story_point: d.storyPoint } : {}),
    ...(d.estHours ? { est_hours: d.estHours } : {}),
    ...(d.assigneeId ? { assignee_id: d.assigneeId } : {}),
    ...(d.targetStartDate ? { target_start_date: `${d.targetStartDate}T00:00:00Z` } : {}),
  }
}

const warningsOf = (answer: Record<string, unknown>): string[] => (Array.isArray(answer.warnings) ? answer.warnings.filter((w): w is string => typeof w === 'string') : [])

/** A refusal of a change, in words a person can act on. Branches on Helix's `code`, never on the sentence. */
export function writeError(status: number, body: Record<string, unknown>): UserError {
  const code = str(body.code) ?? str(asRecord(body.error).code) ?? ''
  const details = asRecord(body.details)
  const sentence = redactTokens(str(body.error) ?? '')
  if (status === 401) return new UserError('helix_token', 'The Helix write token is missing, wrong or expired. Create a new one.')
  switch (code) {
    case 'insufficient_scope':
      return new UserError('helix_scope', `This token cannot do that: it needs "${str(details.required_capability) ?? 'more access'}". Create one with the ticket_authoring scope.`)
    case 'session_required':
      return new UserError('helix_human_only', str(details.field) === 'status' ? 'Helix lets only a person move a ticket out of done.' : 'Helix lets only a person do that, in the browser.')
    case 'insufficient_role':
      return new UserError('helix_role', 'Your Helix role does not allow that.')
    case 'ticket_archived':
      return new UserError('helix_archived', 'That ticket is archived.')
    case 'ticket_not_found':
      return new UserError('helix_not_found', 'Ticket not found (or not visible to this token).', 404)
    case 'write_conflict':
      return new UserError('helix_conflict', 'Someone else changed it at the same moment. Nothing was saved: read it again and retry.', 409)
    case 'invalid_transition': {
      const allowed = Array.isArray(details.allowed) ? details.allowed.filter((s): s is string => typeof s === 'string') : []
      return new UserError('helix_invalid_transition', `Helix does not allow that move${allowed.length ? `. From here: ${allowed.join(', ')}` : ' from the current status'}.`)
    }
    case 'missing_required_fields': {
      const fields = Array.isArray(details.fields) ? details.fields.join(', ') : ''
      return new UserError('helix_missing_fields', `Helix needs more first${fields ? `: ${fields}` : ''}.`)
    }
    case 'rate_limited':
      return new UserError('helix_rate_limited', 'Helix is rate limiting changes (comments: 30 a minute). Wait a minute.')
    default:
      return new UserError(`helix_${code || 'error'}`, sentence || `Helix answered ${status}${code ? ` (${code})` : ''}.`)
  }
}
