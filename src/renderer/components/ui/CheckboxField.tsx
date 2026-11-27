import type { ReactNode } from 'react'
import { Checkbox as CheckboxBox } from '@/components/ui/checkbox'
import { cn } from '../../lib/cn'

/** A checkbox with its label on shadcn's Checkbox (Base UI). shadcn's is only the box; the app wants box + text as one click target. */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 select-none', className)}>
      <CheckboxBox checked={checked} onCheckedChange={(v) => onCheckedChange(v)} />
      {children}
    </label>
  )
}
