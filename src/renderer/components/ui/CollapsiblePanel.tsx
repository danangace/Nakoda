import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '../../lib/cn'

/** A bordered, titled collapsible on shadcn's Collapsible (Base UI); replaces `<details>/<summary>`. */
export function CollapsiblePanel({
  title,
  defaultOpen = false,
  children,
  className,
  panelClassName,
}: {
  title: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  panelClassName?: string
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn('rounded-md border border-border', className)}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('border-t border-border', panelClassName)}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
