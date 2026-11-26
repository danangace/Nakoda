import { PenLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Task } from '../../../shared/tasks'
import { useHelixWriter } from '../../store/helix-writer'
import { HelixChangeDialog } from './HelixChangeDialog'

/**
 * "Update Helix" for a ticket that came from Helix. Absent unless a connection has a write token, so
 * a read-only setup looks exactly as before. Clicks stay inside: the card around it opens the ticket.
 */
export function HelixChangeButton({ task, onDone }: { task: Pick<Task, 'source' | 'externalId'>; onDone?: () => void }) {
  const writer = useHelixWriter((s) => s.writer)
  const load = useHelixWriter((s) => s.load)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void load()
  }, [load])
  if (task.source !== 'helix' || !task.externalId || !writer) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        data-testid="helix-change"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground/60 hover:text-foreground"
      >
        <PenLine className="size-3" /> Update Helix
      </button>
      {open && <HelixChangeDialog connector={writer} ticketKey={task.externalId} onClose={() => setOpen(false)} onDone={onDone} />}
    </span>
  )
}
