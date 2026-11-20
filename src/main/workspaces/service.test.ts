import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, addRepo, saveSettings } from '../settings/store'
import { openDb } from '../sqlite/db'
import { autoName, createWorkspace, listWorkspaces, updateWorkspace } from './service'
import { gitOut, makeRepoWithOrigin } from './testing'

async function setup(setupScript = '') {
  const db = openDb(':memory:')
  const { repo, origin } = makeRepoWithOrigin()
  const workspacesDir = mkdtempSync(join(tmpdir(), 'nakoda-ws-'))
  saveSettings(db, { ...DEFAULT_SETTINGS, workspacesDir })
  const r = await addRepo(db, { path: repo, featureBase: 'origin/dev/tribe-2', branchPrefix: 'feat/tribe-2/', setupScript })
  return { db, repo, origin, repoId: r.id, workspacesDir }
}

const planningValues = { prd: 'https://p', figma: 'https://f', iteration: 'i-16', module: 'kelola' }

describe('updateWorkspace', () => {
  it('turns a free chat into a workflow and fills values later, keeping branch and folder', async () => {
    const { db, repoId } = await setup()
    const ws = await createWorkspace(db, { repoId, name: 'later' })
    // Required fields may stay empty when editing: fill what you know now.
    const planned = updateWorkspace(db, ws.id, { workflowId: 'planning', values: { iteration: 'i-16', module: 'kelola' } })
    expect(planned).toMatchObject({ workflowId: 'planning', branch: ws.branch, base: ws.base, worktreePath: ws.worktreePath })
    expect(planned.values).toMatchObject({ iteration: 'i-16', module: 'kelola', prd: '' })
    // Back to a free chat clears the values.
    expect(updateWorkspace(db, ws.id, { workflowId: null, values: { iteration: 'x' } })).toMatchObject({ workflowId: null, values: {} })
  })

  it('rejects an unknown workflow', async () => {
    const { db, repoId } = await setup()
    const ws = await createWorkspace(db, { repoId, name: 'w' })
    expect(() => updateWorkspace(db, ws.id, { workflowId: 'nope', values: {} })).toThrow()
  })
})

describe('createWorkspace', () => {
  it('creates a free-chat worktree: prefix + name, from the fetched project base', async () => {
    const { db, repo, origin, repoId, workspacesDir } = await setup()
    // A newer commit lands on origin after the clone: the workspace must start from it.
    const other = join(mkdtempSync(join(tmpdir(), 'nakoda-other-')), 'c')
    execFileSync('git', ['clone', '-q', '-b', 'dev/tribe-2', origin, other], { stdio: 'pipe' })
    writeFileSync(join(other, 'new.txt'), 'x')
    execFileSync('git', ['add', '.'], { cwd: other })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=T', 'commit', '-q', '-m', 'new'], { cwd: other })
    execFileSync('git', ['push', '-q', 'origin', 'dev/tribe-2'], { cwd: other, stdio: 'pipe' })

    const ws = await createWorkspace(db, { repoId, name: 'rapikan-tabel' })
    expect(ws).toMatchObject({ branch: 'feat/tribe-2/rapikan-tabel', base: 'origin/dev/tribe-2', workflowId: null, values: {} })
    expect(ws.worktreePath).toBe(join(workspacesDir, 'repo', 'rapikan-tabel'))
    expect(existsSync(join(ws.worktreePath, 'new.txt'))).toBe(true)
    expect(gitOut(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(gitOut(repo, 'status', '--porcelain')).toBe('')
    expect(ws.setupStatus).toBe('skipped')
  })

  it('generates a name when none is given (AC-W1)', async () => {
    const { db, repoId } = await setup()
    const a = await createWorkspace(db, { repoId })
    const b = await createWorkspace(db, { repoId })
    expect(a.name).toMatch(/^ws-\d{4}-\d{4}$/)
    expect(b.name).toBe(`${a.name}-2`)
    expect(a.branch).toBe(`feat/tribe-2/${a.name}`)
  })

  it('uses a workflow: required fields, values stored, base from its branch field (AC-F2)', async () => {
    const { db, repoId } = await setup('echo hi')
    await expect(createWorkspace(db, { repoId, workflowId: 'planning', values: { prd: 'https://p' } })).rejects.toThrow(
      /Fill in: Figma, Iteration, Module/,
    )
    const ws = await createWorkspace(db, { repoId, name: 'plan', workflowId: 'planning', values: { ...planningValues, base: 'origin/main' } })
    expect(ws).toMatchObject({ workflowId: 'planning', base: 'origin/main', setupStatus: 'pending' })
    expect(ws.values).toMatchObject(planningValues)
  })

  it('an Advanced base wins over the workflow field and the project base', async () => {
    const { db, repoId } = await setup()
    const ws = await createWorkspace(db, { repoId, name: 'x', workflowId: 'planning', values: { ...planningValues, base: 'origin/dev/tribe-2' }, base: 'origin/main' })
    expect(ws.base).toBe('origin/main')
  })

  it('a hotfix can start from a release tag that only exists on origin', async () => {
    const { db, repo, repoId } = await setup()
    execFileSync('git', ['-C', repo, 'tag', 'v9.9.9'])
    execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'v9.9.9'])
    execFileSync('git', ['-C', repo, 'tag', '-d', 'v9.9.9'])
    const ws = await createWorkspace(db, { repoId, name: 'hot', base: 'v9.9.9' })
    expect(ws.base).toBe('v9.9.9')
    await expect(createWorkspace(db, { repoId, name: 'hot2', base: 'v0.0.0' })).rejects.toThrow(/Base not found/)
  })

  it('a plain local base (main) is pulled from origin first', async () => {
    const { db, repo, origin, repoId } = await setup()
    // A teammate pushes a new commit to main; the local main is now behind.
    const other = mkdtempSync(join(tmpdir(), 'nakoda-other-'))
    execFileSync('git', ['clone', '-q', origin, other])
    execFileSync('git', ['-C', other, 'config', 'user.email', 't@example.com'])
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test'])
    writeFileSync(join(other, 'new.txt'), 'new\n')
    execFileSync('git', ['-C', other, 'add', '.'])
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'teammate'])
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:main'])
    const before = gitOut(repo, 'rev-parse', 'main')
    const ws = await createWorkspace(db, { repoId, name: 'stg', base: 'main' })
    const pulled = gitOut(repo, 'rev-parse', 'main')
    expect(pulled).not.toBe(before)
    expect(existsSync(join(ws.worktreePath, 'new.txt'))).toBe(true)
  })

  it('refuses a base that cannot be fast-forwarded and creates nothing', async () => {
    const { db, repo, repoId } = await setup()
    writeFileSync(join(repo, 'local.txt'), 'x\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'local only'])
    // Make origin/main differ too, so main has diverged.
    execFileSync('git', ['-C', repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main', '--force'])
    execFileSync('git', ['-C', repo, 'reset', '-q', '--hard', 'HEAD~1'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'diverge'])
    await expect(createWorkspace(db, { repoId, name: 'stg2', base: 'main' })).rejects.toThrow(/Could not pull main first/)
    expect(listWorkspaces(db)).toHaveLength(0)
  })

  it('a defect workspace is a bug fix: fix/ instead of feat/ in its branch', async () => {
    const { db, repoId } = await setup()
    const values = { defect: 'x', environment: 'dev', app: 'core', url_page: 'https://a.test', steps: '1', expected: 'e', actual: 'a', severity: 'minor', handling: 'defect development', iteration: 'i-1' }
    const fix = await createWorkspace(db, { repoId, name: 'link-redirect', workflowId: 'defect', values })
    expect(fix.branch).toBe('fix/tribe-2/link-redirect')
    const feat = await createWorkspace(db, { repoId, name: 'other' })
    expect(feat.branch).toBe('feat/tribe-2/other')
  })

  it('rejects a duplicate name and an unknown base', async () => {
    const { db, repoId } = await setup()
    await createWorkspace(db, { repoId, name: 'a' })
    await expect(createWorkspace(db, { repoId, name: 'a' })).rejects.toThrow(/exists/)
    await expect(createWorkspace(db, { repoId, name: 'b', base: 'origin/nope' })).rejects.toThrow(/Base not found/)
    expect(listWorkspaces(db)).toHaveLength(1)
  })
})

describe('autoName', () => {
  it('formats the time and adds a suffix when taken', () => {
    const now = new Date(2026, 10, 11, 21, 40)
    expect(autoName(() => false, now)).toBe('ws-1111-2140')
    expect(autoName((n) => n === 'ws-1111-2140', now)).toBe('ws-1111-2140-2')
  })
})
