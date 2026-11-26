import { ListTree } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Task } from '../../../shared/tasks'
import { useHelixWriter } from '../../store/helix-writer'
import { BreakdownDialog } from './BreakdownDialog'

/**
 * "Break down" for a Helix story or task you did not write: add subtasks under it. Absent unless a
 * connection has a write token, and for a defect (it has no subtasks to plan). The dialog says why
 * when Helix would refuse (an epic, a subtask, a ticket already done).
 */
export function BreakdownButton({ task, connectorId, onDone }: { task: Pick<Task, 'source' | 'externalId' | 'kind'>; connectorId?: string; onDone?: () => void }) {
  const writer = useHelixWriter((s) => s.writer)
  const load = useHelixWriter((s) => s.load)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    void load()
  }, [load])
  if (task.source !== 'helix' || !task.externalId || task.kind === 'defect' || !writer || (connectorId && writer.id !== connectorId)) return null
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" data-testid="helix-breakdown" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1 text-xs text-foreground/60 hover:text-foreground">
        <ListTree className="size-3" /> Break down
      </button>
      {open && <BreakdownDialog connector={writer} ticketKey={task.externalId} onClose={() => setOpen(false)} onDone={onDone} />}
    </span>
  )
}
