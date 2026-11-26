import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFECT_WORKFLOW_ID, branchPrefixFor } from '../../shared/branch'
import { type AgentId, type Lifecycle, LifecycleInput, type Workspace, WorkspaceInput, type WorkspaceStatus, WorkspaceUpdate } from '../../shared/schemas'
import type { BoardColumn } from '../../shared/tasks'
import { getWorkflow, resolveValues } from '../workflows/service'
import { UserError } from '../errors'
import { expandHome, nowIso } from '../paths'
import { getRepo, getSettings } from '../settings/store'
import type { Db } from '../sqlite/db'
import { type Git, addWorktree, fetchForBase, fetchTag, pullLocalBase, git as defaultGit, refExists } from './git'

type WorkspaceRow = {
  id: string
  repo_id: string
  name: string
  workflow_id: string | null
  values_json: string
  branch: string
  base: string
  worktree_path: string
  stage: string
  lifecycle: Lifecycle | null
  setup_status: Workspace['setupStatus']
  created_at: string
  archived_at: string | null
}

/** Live status per workspace comes from its chats (T25); stored rows default to idle. */
export type StatusLookup = (workspaceId: string) => WorkspaceStatus

type AgentRow = { agent: AgentId; model: string; config_dir: string | null; label: string | null }

/** The chat used last in a workspace, for the sidebar's "Claude Sonnet · .claude-sid" label. */
function lastAgent(db: Db, workspaceId: string): Workspace['agent'] {
  const row = db
    .prepare(
      `SELECT c.agent, c.model, a.config_dir, a.label FROM chats c LEFT JOIN accounts a ON a.id = c.account_id
       WHERE c.workspace_id = ? ORDER BY COALESCE(c.last_active_at, c.created_at) DESC LIMIT 1`,
    )
    .get(workspaceId) as AgentRow | undefined
  return row ? { agent: row.agent, model: row.model, configDir: row.config_dir, accountLabel: row.label } : null
}

const COLUMN_LIFECYCLE: Record<BoardColumn, Lifecycle> = { backlog: 'planning', in_progress: 'in_progress', review: 'in_review', done: 'done' }

/** Chosen by hand wins; otherwise the board column of the ticket worked on last, if any. */
function lifecycleOf(db: Db, r: WorkspaceRow): Pick<Workspace, 'lifecycle' | 'lifecycleSource'> {
  if (r.lifecycle) return { lifecycle: r.lifecycle, lifecycleSource: 'manual' }
  const task = db.prepare('SELECT board_column FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1').get(r.id) as
    | { board_column: BoardColumn }
    | undefined
  return task ? { lifecycle: COLUMN_LIFECYCLE[task.board_column], lifecycleSource: 'task' } : { lifecycle: null, lifecycleSource: null }
}

const toWorkspace = (db: Db, r: WorkspaceRow, status: StatusLookup, agent: Workspace['agent'] = null): Workspace => ({
  id: r.id,
  repoId: r.repo_id,
  name: r.name,
  workflowId: r.workflow_id,
  values: JSON.parse(r.values_json) as Record<string, string>,
  base: r.base,
  branch: r.branch,
  worktreePath: r.worktree_path,
  stage: r.stage,
  setupStatus: r.setup_status,
  status: status(r.id),
  ...lifecycleOf(db, r),
  agent,
  createdAt: r.created_at,
  archivedAt: r.archived_at,
})

const idle: StatusLookup = () => 'idle'

export function listWorkspaces(db: Db, status: StatusLookup = idle): Workspace[] {
  const rows = db.prepare('SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY created_at').all() as WorkspaceRow[]
  return rows.map((r) => toWorkspace(db, r, status, lastAgent(db, r.id)))
}

export function getWorkspace(db: Db, id: string, status: StatusLookup = idle): Workspace {
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
  if (!row) throw new UserError('workspace_not_found', 'Workspace not found', 404)
  return toWorkspace(db, row, status, lastAgent(db, id))
}

export function setSetupStatus(db: Db, id: string, status: Workspace['setupStatus']): void {
  db.prepare('UPDATE workspaces SET setup_status = ? WHERE id = ?').run(status, id)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `ws-1111-2140` style name; adds a suffix when taken. */
export function autoName(taken: (name: string) => boolean, now = new Date()): string {
  const base = `ws-${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  if (!taken(base)) return base
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`
}

/**
 * New workspace = a git worktree on a new branch `<project prefix><name>`. Free chat, or a
 * workflow whose values reach Claude every turn (D-15, D-16). The base is, in order: the
 * Advanced override, the workflow's branch field, the project base. The project's main
 * checkout is never touched.
 */
export async function createWorkspace(db: Db, input: unknown, run: Git = defaultGit): Promise<Workspace> {
  const parsed = WorkspaceInput.safeParse(input)
  if (!parsed.success) throw new UserError('invalid_workspace', parsed.error.issues[0]?.message ?? 'Invalid workspace')
  const data = parsed.data
  const repo = getRepo(db, data.repoId)
  const settings = getSettings(db)
  const workflow = data.workflowId ? getWorkflow(db, data.workflowId) : null
  const values = workflow ? resolveValues(workflow, data.values) : {}

  const workspacesDir = join(expandHome(settings.workspacesDir), repo.name)
  const taken = (name: string) =>
    existsSync(join(workspacesDir, name)) || Boolean(db.prepare('SELECT 1 FROM workspaces WHERE repo_id = ? AND name = ?').get(repo.id, name))
  const name = data.name?.trim() || autoName(taken)
  const branch = `${branchPrefixFor(repo.branchPrefix, workflow?.id === DEFECT_WORKFLOW_ID)}${name}`
  const worktreePath = join(workspacesDir, name)
  const branchField = workflow?.fields.find((f) => f.type === 'branch')
  const base = data.base?.trim() || (branchField ? values[branchField.key] : '') || repo.featureBase

  if (existsSync(worktreePath)) throw new UserError('path_exists', `Folder already exists: ${worktreePath}`, 409)
  if (await refExists(run, repo.path, `refs/heads/${branch}`)) {
    throw new UserError('branch_exists', `Branch already exists: ${branch}`, 409)
  }
  try {
    await fetchForBase(run, repo.path, base)
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    if (/couldn't find remote ref|not our ref|invalid refspec/i.test(stderr)) {
      throw new UserError('base_not_found', `Base not found: ${base}`)
    }
    throw new UserError('fetch_failed', `git fetch failed: ${stderr.trim() || (error as Error).message}`)
  }
  try {
    await pullLocalBase(run, repo.path, base)
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message
    throw new UserError('pull_failed', `Could not pull ${base} first: ${detail}`, 409)
  }
  if (!(await refExists(run, repo.path, base))) await fetchTag(run, repo.path, base)
  if (!(await refExists(run, repo.path, base))) throw new UserError('base_not_found', `Base not found: ${base}`)

  mkdirSync(dirname(worktreePath), { recursive: true })
  try {
    await addWorktree(run, repo.path, branch, worktreePath, base)
  } catch (error) {
    throw new UserError('worktree_failed', `git worktree add failed: ${(error as { stderr?: string }).stderr ?? (error as Error).message}`)
  }

  const id = randomUUID()
  db.prepare(
    `INSERT INTO workspaces (id, repo_id, kind, name, branch, base, worktree_path, setup_status, workflow_id, values_json, created_at)
     VALUES (?, ?, 'feature', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    repo.id,
    name,
    branch,
    base,
    worktreePath,
    repo.setupScript.trim() ? 'pending' : 'skipped',
    workflow?.id ?? null,
    JSON.stringify(values),
    nowIso(),
  )
  return getWorkspace(db, id)
}

/**
 * Change an existing workspace's type and field values (e.g. fill Iteration / Module later, or turn
 * a free chat into a Planning workspace). The branch, base and folder never change; chats pick the
 * new values up from their next message.
 */
export function updateWorkspace(db: Db, id: string, input: unknown, status: StatusLookup = idle): Workspace {
  const ws = getWorkspace(db, id)
  if (ws.archivedAt) throw new UserError('workspace_archived', 'This workspace is archived', 409)
  const parsed = WorkspaceUpdate.safeParse(input)
  if (!parsed.success) throw new UserError('invalid_workspace', parsed.error.issues[0]?.message ?? 'Invalid workspace')
  const workflow = parsed.data.workflowId ? getWorkflow(db, parsed.data.workflowId) : null
  const values = workflow ? resolveValues(workflow, parsed.data.values, { requireAll: false }) : {}
  db.prepare('UPDATE workspaces SET workflow_id = ?, values_json = ? WHERE id = ?').run(workflow?.id ?? null, JSON.stringify(values), id)
  return getWorkspace(db, id, status)
}

/** Say where the work stands, or `null` to follow the assigned ticket again. */
export function setLifecycle(db: Db, id: string, input: unknown, status: StatusLookup = idle): Workspace {
  const ws = getWorkspace(db, id)
  if (ws.archivedAt) throw new UserError('workspace_archived', 'This workspace is archived', 409)
  const parsed = LifecycleInput.safeParse(input)
  if (!parsed.success) throw new UserError('invalid_lifecycle', 'Pick planning, in progress, in review, done or dropped')
  db.prepare('UPDATE workspaces SET lifecycle = ? WHERE id = ?').run(parsed.data.lifecycle, id)
  return getWorkspace(db, id, status)
}
