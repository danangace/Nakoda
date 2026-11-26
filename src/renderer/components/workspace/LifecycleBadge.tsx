import { LIFECYCLE_LABEL, type Lifecycle } from '../../../shared/schemas'
import { cn } from '../../lib/cn'

const TONE: Record<Lifecycle, string> = {
  planning: 'bg-muted-foreground/15 text-muted-foreground',
  in_progress: 'bg-info/10 text-info',
  in_review: 'bg-warning/10 text-warning',
  done: 'bg-success/10 text-success',
  dropped: 'bg-muted-foreground/10 text-muted-foreground/70 line-through',
}

/** Where the work stands (planning … dropped). Not the live chat status; that is the StatusDot. */
export function LifecycleBadge({ lifecycle, className }: { lifecycle: Lifecycle; className?: string }) {
  return (
    <span data-testid="lifecycle-badge" className={cn('shrink-0 rounded px-1.5 py-px text-[11px] leading-4 font-medium whitespace-nowrap', TONE[lifecycle], className)}>
      {LIFECYCLE_LABEL[lifecycle]}
    </span>
  )
}
