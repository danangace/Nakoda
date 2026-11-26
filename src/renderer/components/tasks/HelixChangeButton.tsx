import { PenLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Task } from '../../../shared/tasks'
import { useHelixWriter } from '../../store/helix-writer'
import { HelixChangeDialog } from './HelixChangeDialog'

/**
 * "Update Helix" for a ticket that came from Helix. Absent unless a connection has a write token, so
 * a read-only setup looks exactly as before. Clicks stay inside: the card around it opens the ticket.
 */
export function HelixChangeButton({ task, connectorId, compact, onDone }: { task: Pick<Task, 'source' | 'externalId'>; connectorId?: string; compact?: boolean; onDone?: () => void }) {
  const writer = useHelixWriter((s) => s.writer)
  const load = useHelixWriter((s) => s.load)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void load()
  }, [load])
  if (task.source !== 'helix' || !task.externalId || !writer || (connectorId && writer.id !== connectorId)) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid="helix-change"
        aria-label="Update Helix"
        title="Update Helix: move its status or comment"
        onClick={() => setOpen(true)}
        className={compact ? 'inline-flex size-6 shrink-0 items-center justify-center rounded text-foreground/60 hover:bg-secondary hover:text-foreground' : 'inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-foreground/60 hover:text-foreground'}
      >
        <PenLine className={compact ? 'size-3.5' : 'size-3'} /> {!compact && 'Update Helix'}
      </button>
      {open && <HelixChangeDialog connector={writer} ticketKey={task.externalId} onClose={() => setOpen(false)} onDone={onDone} />}
    </span>
  )
}
