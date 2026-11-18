import type { Iteration } from '../../shared/connectors'
import type { TaskDefaults } from '../../shared/schemas'

/** The iteration a saved default means for this board's list: the active one, or that exact one if it still exists. */
export function resolveIteration(list: Iteration[], pref: TaskDefaults['iteration']): number | null {
  if (pref === null) return null
  if (pref === 'active') return list.find((i) => i.status === 'active')?.id ?? null
  return list.some((i) => i.id === pref) ? pref : null
}
