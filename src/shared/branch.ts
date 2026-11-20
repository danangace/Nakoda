/**
 * Branch prefix for a new workspace. The project prefix is the feature one (`feat/tribe-2/`); a bug fix
 * uses the same with `fix/` (rules/git-branching: `fix/tribe-2/<name>`). Other prefixes are left as typed.
 */
export function branchPrefixFor(prefix: string, isDefect: boolean): string {
  return isDefect ? prefix.replace(/^feat\//, 'fix/') : prefix
}

/** The seeded Defect workflow; a workspace made with it is a bug fix. */
export const DEFECT_WORKFLOW_ID = 'defect'
