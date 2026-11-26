import { Menu } from '@base-ui/react/menu'
import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
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

const ITEM = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground outline-none select-none data-highlighted:bg-secondary'

/**
 * A "⋯" button that opens a short list of actions (shadcn "base" dropdown menu on Base UI). Keyboard,
 * Esc and a click outside close it; choosing an item closes it too.
 */
export function ActionMenu({ actions, label, testId, className }: { actions: MenuAction[]; label: string; testId?: string; className?: string }) {
  if (actions.length === 0) return null
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        title={label}
        data-testid={testId}
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded text-foreground/60 outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-secondary data-popup-open:text-foreground', className)}
      >
        <MoreHorizontal className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-[70] outline-none">
          <Menu.Popup
            className={cn(
              'min-w-40 origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40 outline-none',
              'transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            )}
          >
            {actions.map((a) =>
              a.href ? (
                <Menu.LinkItem key={a.key} href={a.href} target="_blank" rel="noreferrer noopener" data-testid={a.testId} className={ITEM}>
                  {a.icon}
                  {a.label}
                </Menu.LinkItem>
              ) : (
                <Menu.Item key={a.key} data-testid={a.testId} onClick={a.onSelect} className={ITEM}>
                  {a.icon}
                  {a.label}
                </Menu.Item>
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
