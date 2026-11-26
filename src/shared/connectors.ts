import { z } from 'zod/v4'

/** A connection to an outside task system. The token is never part of this; only where it comes from. */
export const TokenSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stored') }),
  z.object({ kind: z.literal('env'), name: z.string() }),
])
export type TokenSource = z.infer<typeof TokenSource>

export const Connector = z.object({
  id: z.string(),
  kind: z.literal('helix'),
  label: z.string(),
  baseUrl: z.string(),
  tokenSource: TokenSource,
  /** `sidpjm_…a1b2`: enough to recognise the token, useless to use it. Null when no token is available. */
  tokenHint: z.string().nullable(),
  /** The separate token that may change tickets; null = this connection is read-only. Where it comes from, never the token. */
  writeTokenSource: TokenSource.nullable().default(null),
  writeTokenHint: z.string().nullable().default(null),
  lastCheckedAt: z.string().nullable(),
  /** How Helix words map to ours on transfer (editable). */
  mappings: z.object({ severity: z.record(z.string(), z.string()), environment: z.record(z.string(), z.string()) }),
})
export type Connector = z.infer<typeof Connector>

/** What the user types when adding or changing a connection. Exactly one of `token` / `envName` sets the source. */
export const ConnectorInput = z.object({
  kind: z.literal('helix').default('helix'),
  label: z.string().trim().min(1, 'Give the connection a label'),
  baseUrl: z.string().trim().min(1, 'Enter the Helix address'),
  token: z.string().trim().optional(),
  envName: z.string().trim().optional(),
  /** The optional write token: pasted, or the name of a variable. At most one; `clearWrite` removes it. */
  writeToken: z.string().trim().optional(),
  writeEnvName: z.string().trim().optional(),
  clearWrite: z.boolean().optional(),
  mappings: z.object({ severity: z.record(z.string(), z.string()), environment: z.record(z.string(), z.string()) }).optional(),
})
export type ConnectorInput = z.infer<typeof ConnectorInput>

export const TestResult = z.object({
  ok: z.literal(true),
  owner: z.object({ id: z.number(), name: z.string(), username: z.string() }),
  scope: z.string(),
  capabilities: z.array(z.string()),
  expiresAt: z.string().nullable(),
  /** Things worth knowing, e.g. a token that can write or that expires soon. */
  warnings: z.array(z.string()),
})
export type TestResult = z.infer<typeof TestResult>

export const TicketKind = z.enum(['task', 'defect'])
export type TicketKind = z.infer<typeof TicketKind>

/** One row of the External list. Safe to show; never used to build a copy (the list is slim). */
export const ExternalTicket = z.object({
  key: z.string(),
  title: z.string(),
  kind: TicketKind,
  type: z.string(),
  status: z.string(),
  /** Helix's status_category: todo | in_progress | done. Subtasks and stories have different status sets, the category is shared. */
  statusCategory: z.string().nullable().optional(),
  priority: z.string().nullable(),
  board: z.string().nullable(),
  iteration: z.string().nullable(),
  assignee: z.string().nullable(),
  assigneeId: z.number().nullable().optional(),
  /** For a subtask listed on its own: the story it belongs to. */
  parent: z.object({ key: z.string(), title: z.string() }).nullable().optional(),
  dueDate: z.string().nullable(),
  url: z.string(),
})
export type ExternalTicket = z.infer<typeof ExternalTicket>

export const ExternalPage = z.object({
  items: z.array(ExternalTicket),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
})
export type ExternalPage = z.infer<typeof ExternalPage>

export const ExternalFilters = z.object({
  boards: z.array(z.object({ id: z.number(), name: z.string() })),
})
export type ExternalFilters = z.infer<typeof ExternalFilters>

export const Iteration = z.object({ id: z.number(), name: z.string(), status: z.string() })
export type Iteration = z.infer<typeof Iteration>

/**
 * Helix statuses seen on real tickets (2026-11-13). Helix has no endpoint that lists them and
 * silently returns nothing for a value it does not know (`todo` instead of `to_do`), so the filter
 * only offers these.
 */
export const HELIX_STATUSES = ['to_do', 'in_progress', 'in_review', 'in_testing', 'ready_to_test', 'ready_to_staging', 'done'] as const

/**
 * Subtasks have their own, shorter workflow than stories and defects (live check 2026-11-13:
 * subtasks are only open / in_progress / done; a to-do subtask is `open`, never `to_do`).
 * The filter matches on Helix's status_category, so a story's defect children (which use the
 * story statuses) land in the matching group too.
 */
export const HELIX_SUBTASK_STATUSES = [
  { status: 'open', category: 'todo', label: 'Open' },
  { status: 'in_progress', category: 'in_progress', label: 'In progress' },
  { status: 'done', category: 'done', label: 'Done' },
] as const

/** A child ticket's status group (todo | in_progress | done); falls back to the status when Helix sends no category. */
export function statusCategory(t: { status: string; statusCategory?: string | null }): string {
  if (t.statusCategory) return t.statusCategory
  if (t.status === 'open' || t.status === 'to_do') return 'todo'
  return t.status === 'done' ? 'done' : 'in_progress'
}

export type ExternalQuery = { page?: number; boardId?: number; iterationId?: number; mine?: boolean; statuses?: string[] }


/** A subtask to add under an existing ticket (its parent comes from the action). */
export const SubtaskDraft = z.object({
  title: z.string().trim().min(1, 'Every subtask needs a title').max(500, 'A title holds at most 500 characters'),
  storyPoint: z.number().int().positive().max(100).optional(),
  estHours: z.number().positive().max(1000).optional(),
  assigneeId: z.number().int().positive().optional(),
  /** `YYYY-MM-DD`: the planned start. Helix records the real start itself. */
  targetStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
})
export type SubtaskDraft = z.infer<typeof SubtaskDraft>

const ticketKey = z.string().regex(/^[A-Za-z0-9_-]+$/, 'That is not a ticket key')

/** The three things Nakoda may change in Helix. Each is previewed, then confirmed. */
export const HelixWrite = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), key: ticketKey, status: z.string().regex(/^[a-z_]+$/, 'That is not a status'), comment: z.string().max(10_000).optional() }),
  z.object({ action: z.literal('comment'), key: ticketKey, content: z.string().trim().min(1, 'Write a comment first').max(10_000) }),
  z.object({ action: z.literal('subtasks'), parentKey: ticketKey, items: z.array(SubtaskDraft).min(1, 'Add at least one subtask').max(30, 'At most 30 subtasks at a time') }),
])
export type HelixWrite = z.infer<typeof HelixWrite>

/** Exactly what would be sent, so the preview and the call cannot drift apart. */
export const WritePreview = z.object({
  summary: z.string(),
  requests: z.array(z.object({ method: z.enum(['POST', 'PATCH']), path: z.string(), body: z.record(z.string(), z.unknown()) })),
  /** Side effects worth a second look: an email goes out, a change cannot be taken back. */
  notes: z.array(z.string()),
})
export type WritePreview = z.infer<typeof WritePreview>

export const WriteOutcome = z.object({
  /** Everything that was asked is done. */
  ok: z.boolean(),
  /** What Helix accepted: the ticket key, and the title for a subtask. */
  done: z.array(z.object({ key: z.string(), title: z.string().optional() })),
  /** The first thing that failed; later items were not tried. */
  failure: z.object({ code: z.string(), message: z.string(), title: z.string().optional() }).nullable(),
  warnings: z.array(z.string()),
})
export type WriteOutcome = z.infer<typeof WriteOutcome>

export const WriteLogEntry = z.object({
  id: z.string(),
  at: z.string(),
  action: z.enum(['status', 'comment', 'subtask']),
  ticketKey: z.string(),
  summary: z.string(),
  ok: z.boolean(),
  errorCode: z.string().nullable(),
})
export type WriteLogEntry = z.infer<typeof WriteLogEntry>

/** Helix's `allowed-transitions`: ticket type → status → statuses it may move to. */
export const AllowedTransitions = z.record(z.string(), z.record(z.string(), z.array(z.string())))
export type AllowedTransitions = z.infer<typeof AllowedTransitions>
