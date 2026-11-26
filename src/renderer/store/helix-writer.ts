import { create } from 'zustand'
import type { Connector } from '../../shared/connectors'
import { api } from '../api/nakoda'

const FRESH_MS = 30_000

type State = {
  /** The connection that may change tickets, if any. */
  writer: Connector | null
  at: number
  load: (force?: boolean) => Promise<void>
}

/** Cards and panels ask "can I change tickets?"; this answers them all from one request. */
export const useHelixWriter = create<State>((set, get) => ({
  writer: null,
  at: 0,
  load: async (force = false) => {
    if (!force && Date.now() - get().at < FRESH_MS) return
    set({ at: Date.now() })
    const list = await api.listConnectors().catch(() => [])
    set({ writer: list.find((c) => c.writeTokenSource && c.writeTokenHint) ?? null })
  },
}))
