import { execFileAsync } from '../paths'

export type GitResult = { stdout: string; stderr: string }
export type Git = (repo: string, args: string[]) => Promise<GitResult>

export const git: Git = (repo, args) => execFileAsync('git', ['-C', repo, ...args], { maxBuffer: 10 * 1024 * 1024 })

export async function refExists(run: Git, repo: string, ref: string): Promise<boolean> {
  try {
    await run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

/** Remote bases are fetched first, so a worktree never starts from a stale local ref. */
export async function fetchForBase(run: Git, repo: string, base: string): Promise<void> {
  const match = base.match(/^([^/]+)\/(.+)$/)
  if (!match) return
  const [, remote, branch] = match
  const { stdout } = await run(repo, ['remote'])
  if (!stdout.split('\n').includes(remote ?? '')) return
  await run(repo, ['fetch', remote ?? '', branch ?? ''])
}

/**
 * A plain local branch as the base (e.g. `main`): bring it up to date with origin first, fast-forward
 * only. If it is the branch checked out in the project folder it is merged there (`--ff-only`), else
 * updated in place. Does nothing when origin has no such branch, or the local one is already ahead.
 * Throws with git's message when it cannot be fast-forwarded (diverged, or local changes in the way).
 */
export async function pullLocalBase(run: Git, repo: string, base: string): Promise<void> {
  if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(base)) return
  if (!(await refExists(run, repo, `refs/heads/${base}`))) return
  try {
    await run(repo, ['ls-remote', '--exit-code', '--heads', 'origin', base])
  } catch {
    return
  }
  await run(repo, ['fetch', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`])
  const isAncestor = async (a: string, b: string) => run(repo, ['merge-base', '--is-ancestor', a, b]).then(() => true, () => false)
  if (await isAncestor(`refs/remotes/origin/${base}`, `refs/heads/${base}`)) return
  if (!(await isAncestor(`refs/heads/${base}`, `refs/remotes/origin/${base}`))) {
    throw new Error(`${base} has commits that are not on origin/${base}, so it cannot be fast-forwarded.`)
  }
  const current = await run(repo, ['symbolic-ref', '--short', '-q', 'HEAD']).then((r) => r.stdout.trim(), () => '')
  if (current === base) await run(repo, ['merge', '--ff-only', `refs/remotes/origin/${base}`])
  else await run(repo, ['update-ref', `refs/heads/${base}`, `refs/remotes/origin/${base}`])
}

/** A release tag typed as the base (hotfix) may not be here yet: fetch just that tag from origin. Best effort. */
export async function fetchTag(run: Git, repo: string, tag: string): Promise<void> {
  if (!/^[A-Za-z0-9._\/-]+$/.test(tag) || tag.startsWith('-')) return
  await run(repo, ['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]).catch(() => undefined)
}

export async function addWorktree(run: Git, repo: string, branch: string, path: string, base: string): Promise<void> {
  await run(repo, ['worktree', 'add', '--no-track', '-b', branch, path, base])
}

export async function isDirty(run: Git, worktree: string): Promise<boolean> {
  const { stdout } = await run(worktree, ['status', '--porcelain'])
  return stdout.trim().length > 0
}

export async function removeWorktree(run: Git, repo: string, path: string, force: boolean): Promise<void> {
  await run(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
}

export async function deleteBranch(run: Git, repo: string, branch: string): Promise<void> {
  await run(repo, ['branch', '-D', branch])
}
