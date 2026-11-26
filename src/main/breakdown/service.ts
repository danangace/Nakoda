import { dirname } from 'node:path/posix'
import { z } from 'zod/v4'
import { PARENT_TYPES_FOR_SUBTASKS } from '../../shared/breakdown'
import { type OpenQuestionsReport, parseOpenQuestions } from '../../shared/open-questions'
import type { AgentId } from '../../shared/schemas'
import { defaultAccount } from '../accounts/service'
import type { ConnectorService } from '../connectors/service'
import type { DocsService } from '../docs/service'
import { UserError } from '../errors'
import type { AgentAdapter } from '../native-chat/types'
import { nowIso } from '../paths'
import { getSettings } from '../settings/store'
import type { Db } from '../sqlite/db'
import { BUILT_IN_RULES, buildDraftRequest, cleanDraft } from './prompt'

/** Where the skill lives in the vault; read from the docs root when it is there. */
export const SKILL_PATH = 'skills/helix/helix-breakdown-subtasks/SKILL.md'
const DRAFT_TIMEOUT_MS = 180_000
const OQ_FILE = 'Open Questions.md'

const DraftInput = z.object({
  connectorId: z.string().min(1),
  key: z.string().regex(/^[A-Za-z0-9_-]+$/, 'That is not a ticket key'),
  docPath: z.string().min(1).endsWith('.md', 'Pick a markdown document'),
  hint: z.string().max(2000).optional(),
})

const SourceInput = z.object({ connectorId: z.string().min(1), key: z.string().min(1), docPath: z.string().min(1), created: z.number().int().min(0).max(200) })

export type SpecCheck = OpenQuestionsReport & {
  /** The Open Questions file found next to the spec, or null when there is none. */
  questionsPath: string | null
}

export type Draft = { text: string; notes: string[]; count: number; truncated: boolean; model: string; account: string; rules: 'vault' | 'built-in' }
export type BreakdownSource = { docPath: string; created: number; updatedAt: string }

type SourceRow = { doc_path: string; created_count: number; updated_at: string }

/**
 * Breaking a story down from its spec: is the spec ready (its open questions answered), a first draft of
 * the list from Claude, and which document a ticket was broken down from. Nothing here writes to Helix.
 */
export class BreakdownService {
  constructor(
    private readonly db: Db,
    private readonly docs: DocsService,
    private readonly connectors: ConnectorService,
    private readonly adapters: Partial<Record<AgentId, AgentAdapter>>,
  ) {}

  /** The Open Questions file in the spec's folder: how many questions, and which are still open. */
  specCheck(docPath: string): SpecCheck {
    const folder = dirname(docPath)
    const questionsPath = folder === '.' ? OQ_FILE : `${folder}/${OQ_FILE}`
    try {
      return { questionsPath, ...parseOpenQuestions(this.docs.read(questionsPath).body) }
    } catch {
      return { questionsPath: null, total: 0, open: [] }
    }
  }

  /** The rules from the vault's skill when it can be read, else the built-in copy. */
  private rules(): { text: string; from: Draft['rules'] } {
    try {
      const body = this.docs.read(SKILL_PATH).body.trim()
      if (body) return { text: body, from: 'vault' }
    } catch {
      /* not in this docs root */
    }
    return { text: BUILT_IN_RULES, from: 'built-in' }
  }

  async draft(raw: unknown): Promise<Draft> {
    const parsed = DraftInput.safeParse(raw)
    if (!parsed.success) throw new UserError('invalid_draft', parsed.error.issues[0]?.message ?? 'Invalid request')
    const { connectorId, key, docPath, hint } = parsed.data
    const account = defaultAccount(this.db, 'claude')
    if (!account) throw new UserError('no_account', 'Add a Claude account in Settings → Accounts first', 409)
    const adapter = this.adapters.claude
    if (!adapter?.complete) throw new UserError('draft_unsupported', 'Drafting is not available for this agent', 409)

    const spec = this.docs.read(docPath)
    const parent = await this.connectors.ticket(connectorId, key)
    if (!(PARENT_TYPES_FOR_SUBTASKS as readonly string[]).includes(parent.type)) throw new UserError('parent_cannot_have_subtasks', `A ${parent.type.replaceAll('_', ' ')} cannot have subtasks in Helix.`, 409)
    if (parent.status === 'done') throw new UserError('parent_done', 'This ticket is done, and Helix refuses new subtasks under it.', 409)
    const children = await this.connectors.children(connectorId, key)

    const rules = this.rules()
    const request = buildDraftRequest({
      rules: rules.text,
      parent,
      existing: children.filter((c) => c.type === 'subtask').map((c) => ({ key: c.key, title: c.title, status: c.status })),
      spec: { path: docPath, text: spec.body },
      hint,
    })
    const settings = getSettings(this.db)
    const model = settings.models.claude.default
    let answer: string
    try {
      answer = await adapter.complete({ configDir: account.configDir, model, effort: settings.chatDefaults.effort, system: request.system, prompt: request.prompt, signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS) })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Claude did not answer'
      throw new UserError(/logged in|login|auth/i.test(message) ? 'draft_auth' : 'draft_failed', `Claude could not draft this: ${message}`, 409)
    }
    return { ...cleanDraft(answer), truncated: request.truncated, model, account: account.label, rules: rules.from }
  }

  source(connectorId: string, key: string): BreakdownSource | null {
    const row = this.db.prepare('SELECT doc_path, created_count, updated_at FROM breakdown_sources WHERE connector_id = ? AND ticket_key = ?').get(connectorId, key) as SourceRow | undefined
    return row ? { docPath: row.doc_path, created: row.created_count, updatedAt: row.updated_at } : null
  }

  /** One document per parent ticket: choosing another replaces it and starts the count again. */
  saveSource(raw: unknown): BreakdownSource {
    const parsed = SourceInput.safeParse(raw)
    if (!parsed.success) throw new UserError('invalid_source', parsed.error.issues[0]?.message ?? 'Invalid request')
    const { connectorId, key, docPath, created } = parsed.data
    const before = this.source(connectorId, key)
    const total = (before?.docPath === docPath ? before.created : 0) + created
    this.db
      .prepare(
        `INSERT INTO breakdown_sources (connector_id, ticket_key, doc_path, created_count, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (connector_id, ticket_key) DO UPDATE SET doc_path = excluded.doc_path, created_count = excluded.created_count, updated_at = excluded.updated_at`,
      )
      .run(connectorId, key, docPath, total, nowIso())
    return { docPath, created: total, updatedAt: nowIso() }
  }
}
