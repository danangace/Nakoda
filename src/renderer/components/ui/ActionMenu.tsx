import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '../../lib/cn'

export type MenuAction = {
  key: string
  label: ReactNode
  icon?: ReactNode
  /** A link opens in a new tab; otherwise `onSelect` runs. */
  href?: string
  onSelect?: () => void
  testId?: string
}

/**
 * A "⋯" button that opens a short list of actions. Built on shadcn's dropdown-menu (Base UI): keyboard,
 * Esc and a click outside close it; choosing an item closes it too.
 */
export function ActionMenu({ actions, label, testId, className }: { actions: MenuAction[]; label: string; testId?: string; className?: string }) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        data-testid={testId}
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded text-foreground/60 outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-secondary data-popup-open:text-foreground', className)}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        {actions.map((a) =>
          a.href ? (
            <DropdownMenuItem key={a.key} data-testid={a.testId} render={<a href={a.href} target="_blank" rel="noreferrer noopener" />}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={a.key} data-testid={a.testId} onClick={a.onSelect}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
