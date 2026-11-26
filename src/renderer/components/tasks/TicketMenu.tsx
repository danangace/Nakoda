import { ExternalLink, ListTree, PenLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PARENT_TYPES_FOR_SUBTASKS } from '../../../shared/breakdown'
import { useHelixWriter } from '../../store/helix-writer'
import { ActionMenu, type MenuAction } from '../ui/ActionMenu'
import { BreakdownDialog } from './BreakdownDialog'
import { HelixChangeDialog } from './HelixChangeDialog'

export type MenuTicket = {
  /** Where it came from; only a Helix ticket has Helix actions. */
  source: string
  /** The Helix key (`T2-3252`). */
  key: string | null
  url: string | null
  kind: 'task' | 'defect'
  /** Helix type when known (a list row); a board card does not know it, and the dialog checks. */
  type?: string
}

/**
 * One "⋯" menu for a ticket that came from Helix: Open in Helix, Break down, Update Helix. The last two
 * show only when a connection has a write token (a read-only setup has just the link). The dialogs live
 * here, outside the menu, so choosing an item can close the menu and still open its dialog. Clicks stay
 * inside: the card around it opens the ticket.
 */
export function TicketMenu({ ticket, connectorId, showOpen = true, onDone }: { ticket: MenuTicket; connectorId?: string; showOpen?: boolean; onDone?: () => void }) {
  const writer = useHelixWriter((s) => s.writer)
  const load = useHelixWriter((s) => s.load)
  const [dialog, setDialog] = useState<'update' | 'breakdown' | null>(null)
  useEffect(() => {
    void load()
  }, [load])

  const fromHelix = ticket.source === 'helix' && Boolean(ticket.key)
  const canWrite = fromHelix && writer !== null && (!connectorId || writer.id === connectorId)
  // A defect has no subtasks to plan; a type that cannot hold subtasks gets no entry either.
  const canBreakDown = canWrite && ticket.kind !== 'defect' && (ticket.type === undefined || (PARENT_TYPES_FOR_SUBTASKS as readonly string[]).includes(ticket.type))

  const actions: MenuAction[] = [
    ...(showOpen && ticket.url ? [{ key: 'open', label: 'Open in Helix', icon: <ExternalLink className="size-3.5 text-muted-foreground" />, href: ticket.url, testId: 'open-in-helix' }] : []),
    ...(canBreakDown ? [{ key: 'breakdown', label: 'Break down', icon: <ListTree className="size-3.5 text-muted-foreground" />, onSelect: () => setDialog('breakdown'), testId: 'helix-breakdown' }] : []),
    ...(canWrite ? [{ key: 'update', label: 'Update Helix', icon: <PenLine className="size-3.5 text-muted-foreground" />, onSelect: () => setDialog('update'), testId: 'helix-change' }] : []),
  ]
  if (actions.length === 0) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="inline-flex shrink-0">
      <ActionMenu actions={actions} label="Ticket actions" testId="ticket-menu" />
      {dialog === 'update' && writer && ticket.key && <HelixChangeDialog connector={writer} ticketKey={ticket.key} onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog === 'breakdown' && writer && ticket.key && <BreakdownDialog connector={writer} ticketKey={ticket.key} onClose={() => setDialog(null)} onDone={onDone} />}
    </span>
  )
}
